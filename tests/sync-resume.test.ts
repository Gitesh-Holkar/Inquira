/**
 * Regression tests for the sync bugs found in the November 2026 audit (milestone M0, GOAL G-SRC-3):
 * TradeIndia had no time budget and no saved position, built its dates in UTC, and moved its cursor past
 * leads that failed to save; a Gmail backlog relied on an enqueue that the running job's own key dropped.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { integrations, jobs, syncRuns } from "@/modules/core/schema";
import { emailMessages } from "@/modules/email/schema";
import { leads } from "@/modules/leads/schema";
import { getIntegrationInternal, updateIntegrationInternal, writeSecretsInternal } from "@/modules/core/service";
import { syncGmail } from "@/modules/sources/gmail/service";
import { JOB_HANDLERS, tick } from "@/modules/sources/jobs";
import { inquiryWindows, TradeIndiaClient, tradeIndiaDay } from "@/modules/sources/tradeindia/client";
import { syncTradeIndia, type TradeIndiaCursor } from "@/modules/sources/tradeindia/service";
import { fakeGoogle, fixture, toGmailMessage } from "./helpers/fake-google";
import { resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";

const NOW = new Date("2026-11-16T06:00:00Z");

/** A TradeIndia fake that answers from `byFromDate` (rows for the window starting on that IST date). */
function fakeTi(byFromDate: Record<string, unknown[]> = {}) {
  const urls: URL[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    urls.push(u);
    const rows = u.searchParams.get("page_no") === "1" ? (byFromDate[u.searchParams.get("from_date")!] ?? []) : [];
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  return { f, urls };
}
const row = (id: string, over: Record<string, unknown> = {}) => ({
  rfi_id: id, sender_name: "Test Buyer", sender_mobile: `+9190000${id.slice(-5)}`, sender_city: "Pune", sender_state: "Maharashtra", sender_country: "India",
  product_name: "Sample Starch", quantity: "100 Kg", message: "Need price", generated_date: "2026-11-01", generated_time: "10:00:00", ...over,
});

async function configureTradeIndia(orgId: string) {
  await withSystemTx(async (tx) => {
    const integ = await getIntegrationInternal(tx, orgId, "tradeindia");
    await writeSecretsInternal(tx, systemCtx(orgId), integ, { userId: "u1", profileId: "p1", key: "key-12345678" });
    await updateIntegrationInternal(tx, systemCtx(orgId), integ.id, { status: "connected" });
  });
}
async function tiCursor(orgId: string): Promise<TradeIndiaCursor> {
  const [i] = await getDb().select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "tradeindia")));
  return i!.cursor as TradeIndiaCursor;
}

describe("TradeIndia sync is resumable (G-SRC-3)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("builds request dates in IST, not UTC", () => {
    // 00:30 IST on 17 Nov is still 16 Nov in UTC.
    const justAfterMidnightIST = new Date("2026-11-16T19:00:00Z");
    expect(tradeIndiaDay(justAfterMidnightIST)).toBe("2026-11-17");
    const url = new URL(new TradeIndiaClient({ userId: "u", profileId: "p", key: "k" }).url(new Date("2026-11-09T19:00:00Z"), justAfterMidnightIST, 1));
    expect(url.searchParams.get("from_date")).toBe("2026-11-10");
    expect(url.searchParams.get("to_date")).toBe("2026-11-17");
  });

  it("stops at the time budget, saves its position, and the next run resumes there instead of restarting", async () => {
    const { org } = await setupOrgWithUser();
    await configureTradeIndia(org.id);
    const windows = inquiryWindows(new Date(NOW.getTime() - 30 * 86400_000), NOW);
    expect(windows.length).toBe(5);
    const day = (n: number) => tradeIndiaDay(windows[n]!.start);
    const ti = fakeTi({ [day(0)]: [row("900000101")], [day(2)]: [row("900000103")], [day(4)]: [row("900000105")] });

    // The clock passes the budget after two windows have been read.
    const first = await syncTradeIndia(systemCtx(org.id), { fetchImpl: ti.f, delayMs: 0, now: NOW, timeBudgetMs: 1000, clock: () => (ti.urls.length >= 2 ? 10_000 : 0) });
    expect(first).toMatchObject({ fetched: 1, created: 1, more: true });
    expect(ti.urls.map((u) => u.searchParams.get("from_date"))).toEqual([day(0), day(1)]);
    let cur = await tiCursor(org.id);
    expect(cur.lastSuccessTo).toBeUndefined();
    expect(cur.resume).toMatchObject({ windowStart: windows[2]!.start.toISOString(), page: 1, to: NOW.toISOString() });

    // Second run: continues at the third window and finishes the same range.
    const before = ti.urls.length;
    const second = await syncTradeIndia(systemCtx(org.id), { fetchImpl: ti.f, delayMs: 0, now: new Date(NOW.getTime() + 600_000) });
    expect(second).toMatchObject({ fetched: 2, created: 2, errors: 0 });
    expect(second.more).toBeUndefined();
    expect(ti.urls.slice(before).map((u) => u.searchParams.get("from_date"))).toEqual([day(2), day(3), day(4)]);
    cur = await tiCursor(org.id);
    expect(cur).toEqual({ lastSuccessTo: NOW.toISOString() });
    expect(await getDb().select().from(leads)).toHaveLength(3);
    const runs = await getDb().select().from(syncRuns).where(eq(syncRuns.orgId, org.id));
    expect(runs.map((r) => `${r.kind}:${r.status}`).sort()).toEqual(["backfill:partial", "resume:ok"]);
  });

  it("saves the position after each window, so a run killed by the host does not start over", async () => {
    const { org } = await setupOrgWithUser();
    await configureTradeIndia(org.id);
    const windows = inquiryWindows(new Date(NOW.getTime() - 30 * 86400_000), NOW);
    let calls = 0;
    // The third request never returns normally: the function is "killed" (here: the fetch throws a non-API error).
    const f = (async () => {
      if (++calls === 3) throw new Error("socket hang up");
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    const r = await syncTradeIndia(systemCtx(org.id), { fetchImpl: f, delayMs: 0, now: NOW });
    expect(r.errors).toBe(1);
    const cur = await tiCursor(org.id);
    expect(cur.resume?.windowStart).toBe(windows[2]!.start.toISOString());
  });

  it("does not move past a window in which a lead failed to save; skips it only after three attempts", async () => {
    const { org } = await setupOrgWithUser();
    await configureTradeIndia(org.id);
    const windows = inquiryWindows(new Date(NOW.getTime() - 30 * 86400_000), NOW);
    const day = (n: number) => tradeIndiaDay(windows[n]!.start);
    // The second window holds a lead whose quantity overflows the column, so its save fails every time.
    const ti = fakeTi({ [day(0)]: [row("900000201")], [day(1)]: [row("900000202", { quantity: "99999999999999999999 Kg" })], [day(4)]: [row("900000205")] });
    const run = (n: number) => syncTradeIndia(systemCtx(org.id), { fetchImpl: ti.f, delayMs: 0, now: new Date(NOW.getTime() + n * 600_000) });

    const first = await run(0);
    expect(first).toMatchObject({ created: 1, errors: 1, more: true });
    let cur = await tiCursor(org.id);
    expect(cur.lastSuccessTo).toBeUndefined(); // bug 6: this used to advance to "now"
    expect(cur.resume).toMatchObject({ windowStart: windows[1]!.start.toISOString(), attempts: 1 });

    const second = await run(1);
    expect(second).toMatchObject({ errors: 1, more: true });
    expect((await tiCursor(org.id)).resume).toMatchObject({ windowStart: windows[1]!.start.toISOString(), attempts: 2 });

    // Third attempt: the window is skipped with the error recorded, and the rest of the range is read.
    const third = await run(2);
    expect(third.more).toBeUndefined();
    expect(third.created).toBe(1);
    expect(third.errorMessages.join(" ")).toMatch(/skipped after 3 attempts/);
    cur = await tiCursor(org.id);
    expect(cur).toEqual({ lastSuccessTo: NOW.toISOString() });
    const [last] = await getDb().select().from(syncRuns).where(and(eq(syncRuns.orgId, org.id), eq(syncRuns.status, "partial"))).orderBy(syncRuns.startedAt).limit(10).then((r) => r.slice(-1));
    expect(last!.errorMessage).toMatch(/900000202/);
  });
});

describe("a sync that stops early is always picked up on the next tick", () => {
  const original = { ...JOB_HANDLERS };
  beforeEach(resetDb);
  afterEach(() => Object.assign(JOB_HANDLERS, original));
  afterAll(closeDb);

  it("queues a follow-up after the job completes, and the next tick works through the Gmail backlog", async () => {
    const { org } = await setupOrgWithUser();
    await withSystemTx(async (tx) => {
      const integ = await getIntegrationInternal(tx, org.id, "gmail");
      await writeSecretsInternal(tx, systemCtx(org.id), integ, { clientId: "x.apps.googleusercontent.com", clientSecret: "secret-123456", refreshToken: "rt" });
      await updateIntegrationInternal(tx, systemCtx(org.id), integ.id, { status: "connected", accountEmail: "sales@seller.example", config: { ownAddresses: ["sales@seller.example"] } });
    });
    const g = fakeGoogle({ messages: ["tradeindia-inquiry", "ignored-newsletter", "indiamart-enquiry-by-phone"].map((i) => toGmailMessage(fixture(i))) });
    // One message per run, so two stay in the backlog after the first tick.
    JOB_HANDLERS["gmail.sync"] = (ctx) => syncGmail(ctx, { fetchImpl: g.fetch, maxPerRun: 1 });
    JOB_HANDLERS["tradeindia.sync"] = async () => ({ skipped: "not under test" });
    const stored = async () => (await getDb().select().from(emailMessages)).length;
    const queued = async () => (await getDb().select().from(jobs).where(and(eq(jobs.orgId, org.id), eq(jobs.type, "gmail.sync"), eq(jobs.status, "queued"))));

    const t1 = await tick();
    expect(t1.results.find((r) => r.type === "gmail.sync")).toMatchObject({ ok: true, result: { more: true } });
    expect(await stored()).toBe(1);
    // Bug 7: the follow-up exists (queued once, not dropped), and it is not runnable inside the same tick.
    const follow = await queued();
    expect(follow).toHaveLength(1);
    expect(follow[0]!.runAfter.getTime()).toBeGreaterThan(Date.now());

    // "Next tick": make the follow-up due, as ten minutes later it would be.
    const due = () => getDb().update(jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(jobs.orgId, org.id));
    await due();
    await tick();
    expect(await stored()).toBe(2);
    await due();
    const t3 = await tick();
    expect(await stored()).toBe(3);
    expect((t3.results.find((r) => r.type === "gmail.sync")!.result as { more?: boolean }).more).toBeUndefined();
    expect(await queued()).toHaveLength(0); // nothing left to do, so no follow-up
  });
});

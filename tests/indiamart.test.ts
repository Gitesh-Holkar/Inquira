/**
 * IndiaMART Lead Manager APIs (GOAL G-SRC-1, G-SRC-2, G-SRC-6, G-SRC-7, G-SRC-8), against a fake IndiaMART.
 * Field names and formats follow help.indiamart.com (checked 18 Nov 2026); all buyer data here is invented.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withSystemTx } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { auditLogs, integrations, syncRuns } from "@/modules/core/schema";
import { leads } from "@/modules/leads/schema";
import { arrivalRoutesInternal, upsertLeadInternal } from "@/modules/leads/service";
import { indiaMartTime } from "@/modules/sources/indiamart/client";
import { normalizeIndiaMart } from "@/modules/sources/indiamart/normalize";
import { createIndiaMartPushAddress, disconnectIndiaMart, receiveIndiaMartPush, saveIndiaMartKey, syncIndiaMart, testIndiaMartInternal, type IndiaMartCursor } from "@/modules/sources/indiamart/service";
import { startOfTodayIST } from "@/lib/format";
import { addMember, createUser, resetDb, setupOrgWithUser, systemCtx } from "./helpers/db";
import type { Ctx } from "@/modules/core/types";

const KEY = "fake-pull-key-0123456789";
const lead = (over: Record<string, string> = {}) => ({
  UNIQUE_QUERY_ID: "2600000001", QUERY_TYPE: "W", QUERY_TIME: "2026-11-18 11:17:14", SENDER_NAME: "Test Buyer", SENDER_MOBILE: "+91-9000000401",
  SENDER_EMAIL: "buyer401@example.com", SUBJECT: "Requirement for Sample Protein", SENDER_COMPANY: "Sample Foods Pvt Ltd", SENDER_CITY: "Pune",
  SENDER_STATE: "Maharashtra", SENDER_PINCODE: "411001", SENDER_COUNTRY_ISO: "IN", QUERY_PRODUCT_NAME: "Sample Protein Isolate", QUERY_MESSAGE: "Need 500 kg",
  QUERY_MCAT_NAME: "Protein Powder", CALL_DURATION: "", RECEIVER_MOBILE: "", ...over,
});
const push = (l = lead()) => ({ CODE: 200, STATUS: "SUCCESS", RESPONSE: l });

/** A fake Pull API: answers with `byStart(start_time)` leads, records every call, can be told to fail. */
function fakePull(byStart: (start: string) => unknown[] = () => [], answer?: { CODE: number; MESSAGE: string }) {
  const calls: URL[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u);
    if (u.origin + u.pathname !== "https://mapi.indiamart.com/wservce/crm/crmListing/v2/") throw new Error(`unexpected call ${u.pathname}`);
    if (answer) return new Response(JSON.stringify({ ...answer, STATUS: "FAILURE", TOTAL_RECORDS: 0, RESPONSE: [] }), { status: 200 });
    const rows = byStart(u.searchParams.get("start_time")!);
    return new Response(JSON.stringify(rows.length ? { CODE: 200, STATUS: "SUCCESS", MESSAGE: "", TOTAL_RECORDS: rows.length, RESPONSE: rows }
      : { CODE: 204, STATUS: "FAILURE", MESSAGE: "There are no leads in the given time duration.", TOTAL_RECORDS: 0, RESPONSE: [] }), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}
const cursorOf = async (orgId: string) => {
  const [i] = await getDb().select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "indiamart")));
  return i!;
};

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_URL", "https://inquira.example");
  resetEnvCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(closeDb);

describe("IndiaMART lead fields", () => {
  it("builds IST times the way the Pull API wants them", () => {
    expect(indiaMartTime(new Date("2026-11-17T19:00:00Z"))).toBe("18-Nov-202600:30:00");
    expect(indiaMartTime(new Date("2026-01-01T03:30:05Z"))).toBe("01-Jan-202609:00:05");
  });

  it("reads a lead: IST time, phone without the dash, IndiaMART's placeholder name dropped, type as channel", () => {
    const l = normalizeIndiaMart(lead({ SENDER_NAME: "IndiaMART Buyer" }))!;
    expect(l).toMatchObject({
      source: "indiamart", sourceRef: "2600000001", channel: "indiamart_api_w", contactName: null, phone: "+919000000401", country: "India",
      productText: "Sample Protein Isolate", message: "Need 500 kg", isInternational: false, companyName: "Sample Foods Pvt Ltd",
    });
    expect(l.receivedAt.toISOString()).toBe("2026-11-18T05:47:14.000Z");
    expect(normalizeIndiaMart(lead({ QUERY_TYPE: "B" }))!.channel).toBe("indiamart_api_b");
    expect(normalizeIndiaMart(lead({ QUERY_TYPE: "P", QUERY_MESSAGE: "", CALL_DURATION: "42" }))!.message).toBe("Phone call through IndiaMART (42 s)");
    expect(normalizeIndiaMart(lead({ SENDER_COUNTRY_ISO: "AE", SENDER_MOBILE: "+971-500000001" }))).toMatchObject({ country: "AE", isInternational: true, phone: "+971500000001" });
    expect(normalizeIndiaMart(lead({ UNIQUE_QUERY_ID: "" }))).toBeNull();
    expect(normalizeIndiaMart(lead({ UNIQUE_QUERY_ID: "../../x" }))).toBeNull();
  });
});

describe("IndiaMART Push API (G-SRC-1)", () => {
  async function withAddress() {
    const { org, ctx } = await setupOrgWithUser("owner");
    const { url } = await createIndiaMartPushAddress(ctx, {});
    expect(url).toMatch(/^https:\/\/inquira\.example\/api\/webhooks\/indiamart\/[A-Za-z0-9_-]{32}$/);
    return { org, ctx, secret: url.split("/").pop()! };
  }

  it("stores a pushed lead once, answers 200, and rejects a wrong address", async () => {
    const { org, secret } = await withAddress();
    const route = await import("@/app/api/webhooks/indiamart/[secret]/route");
    const post = (s: string, body: string) => route.POST(new Request(`https://inquira.example/api/webhooks/indiamart/${s}`, { method: "POST", body, headers: { "content-type": "application/json" } }), { params: Promise.resolve({ secret: s }) });

    const first = await post(secret, JSON.stringify(push()));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, created: true });
    expect((await post(secret, JSON.stringify(push()))).status).toBe(200); // IndiaMART retries: same lead, stored once
    const rows = await getDb().select().from(leads).where(eq(leads.orgId, org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "indiamart", sourceRef: "2600000001", channel: "indiamart_api_w", city: "Pune" });

    expect((await post("wrong-secret-wrong-secret-0000", JSON.stringify(push()))).status).toBe(404);
    expect((await post("short", JSON.stringify(push()))).status).toBe(404);
    expect((await post(secret, "not json")).status).toBe(400);
    // A request without a lead (IndiaMART's Test button) is acknowledged, so the test passes and Push stays on,
    // but nothing is stored and the card says when it came.
    const empty = await post(secret, JSON.stringify({ CODE: 200, RESPONSE: { SENDER_NAME: "no id" } }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ ok: true, created: false });
    expect((await post(secret, "{}")).status).toBe(200);
    expect((await cursorOf(org.id)).config).toHaveProperty("lastEmptyPushAt");
    expect((await post(secret, "x".repeat(70_000))).status).toBe(413);
    const [bad] = await getDb().select().from(syncRuns).where(and(eq(syncRuns.orgId, org.id), eq(syncRuns.status, "error")));
    expect(bad!.errorMessage).toMatch(/no UNIQUE_QUERY_ID/);
  });

  it("Push alone connects IndiaMART (no Pull key): waiting after the address, connected on the first lead", async () => {
    const { org, ctx, secret } = await withAddress();
    let integ = await cursorOf(org.id);
    expect(integ.status).toBe("configured"); // set up, waiting for IndiaMART's first lead
    expect(integ.lastSuccessAt).toBeNull();
    await receiveIndiaMartPush(secret, {}); // IndiaMART's Test: no lead, does not count as connected
    expect((await cursorOf(org.id)).status).toBe("configured");
    expect(await receiveIndiaMartPush(secret, push())).toMatchObject({ created: true });
    integ = await cursorOf(org.id);
    expect(integ).toMatchObject({ status: "connected" });
    expect(integ.lastSuccessAt).not.toBeNull();
    expect(integ.config).toHaveProperty("lastPushAt");
    expect(await getDb().select().from(auditLogs).where(eq(auditLogs.action, "integration.push_ok"))).toHaveLength(1);
    // The Pull sync has nothing to do without a key, and says so.
    expect(await syncIndiaMart(systemCtx(org.id), { fetchImpl: fakePull().f })).toMatchObject({ skipped: "not configured" });
    // Saving a Pull key later keeps IndiaMART connected (Push works) while the key waits for its test.
    await saveIndiaMartKey(ctx, { key: KEY });
    integ = await cursorOf(org.id);
    expect(integ.status).toBe("connected");
    expect(integ.config).toHaveProperty("pullSavedAt");
    // A rejected Pull key stays visible even when Push keeps delivering.
    await getDb().update(integrations).set({ status: "reauth_required" }).where(eq(integrations.id, integ.id));
    await receiveIndiaMartPush(secret, push(lead({ UNIQUE_QUERY_ID: "2600000003" })));
    expect((await cursorOf(org.id)).status).toBe("reauth_required");
  });

  it("a new address replaces the old one; the secret itself is never stored", async () => {
    const { org, ctx, secret } = await withAddress();
    const { url } = await createIndiaMartPushAddress(ctx, {});
    expect(await receiveIndiaMartPush(secret, push())).toBeNull();
    expect(await receiveIndiaMartPush(url.split("/").pop()!, push())).toMatchObject({ created: true });
    const integ = await cursorOf(org.id);
    expect(JSON.stringify(integ.config)).not.toContain(secret);
    expect(JSON.stringify(await getDb().select().from(auditLogs))).not.toContain(url.split("/").pop()!);
  });

  it("Disconnect forgets the key, turns the push address off and stops the sync; leads stay; sales cannot", async () => {
    const { org, ctx, secret } = await withAddress();
    await saveIndiaMartKey(ctx, { key: KEY });
    expect(await receiveIndiaMartPush(secret, push())).toMatchObject({ created: true });
    const u = await createUser();
    await addMember(org.id, u, "sales");
    await expect(disconnectIndiaMart({ orgId: org.id, actor: { kind: "human", userId: u.id, email: u.email, role: "sales" } }, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await disconnectIndiaMart(ctx, {}); // as the owner, under row-level security
    expect(await receiveIndiaMartPush(secret, push(lead({ UNIQUE_QUERY_ID: "2600000002" })))).toBeNull();
    const integ = await cursorOf(org.id);
    expect(integ.status).toBe("not_connected");
    expect(integ.config).not.toHaveProperty("pushSecretHash");
    expect(integ.config).not.toHaveProperty("lastPushAt"); // the dashboard no longer counts the API as connected
    expect(integ.config).not.toHaveProperty("pullSavedAt");
    expect(await syncIndiaMart(systemCtx(org.id), { fetchImpl: fakePull().f })).toMatchObject({ skipped: "not configured" });
    expect(await getDb().select().from(leads).where(eq(leads.orgId, org.id))).toHaveLength(1);
  });

  it("needs a public https address, and only people who manage connections can create one", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    const u = await createUser();
    await addMember(org.id, u, "sales");
    const sales: Ctx = { orgId: org.id, actor: { kind: "human", userId: u.id, email: u.email, role: "sales" } };
    await expect(createIndiaMartPushAddress(sales, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.stubEnv("APP_URL", "http://localhost:3000");
    resetEnvCache();
    await expect(createIndiaMartPushAddress(ctx, {})).rejects.toThrow(/https/);
  });
});

describe("IndiaMART Pull API (G-SRC-2)", () => {
  const NOW = new Date("2026-11-18T06:00:00Z");
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

  async function connected() {
    const { org, ctx } = await setupOrgWithUser("owner");
    await saveIndiaMartKey(ctx, { key: KEY }); // as the owner, under row-level security
    return { org, ctx };
  }

  it("tests the key, then loads 30 days one week per run, never more than one call per 5 minutes", async () => {
    const { org, ctx } = await connected();
    const ti = fakePull((start) => (start.startsWith("19-Oct-2026") ? [lead({ UNIQUE_QUERY_ID: "2600000101", QUERY_TIME: "2026-10-20 10:00:00" })] : []));
    await expect(testIndiaMartInternal(ctx, ti.f, NOW)).resolves.toMatchObject({ ok: true, sample: 0 });
    expect(ti.calls[0]!.searchParams.get("glusr_crm_key")).toBe(KEY);
    expect((await cursorOf(org.id)).status).toBe("connected");

    const sys = systemCtx(org.id);
    expect(await syncIndiaMart(sys, { fetchImpl: ti.f, now: at(1) })).toMatchObject({ skipped: "IndiaMART allows one call every 5 minutes" });
    expect(ti.calls).toHaveLength(1);

    const starts: string[] = [];
    for (let run = 1; run <= 6; run++) {
      const r = await syncIndiaMart(sys, { fetchImpl: ti.f, now: at(run * 10) });
      expect(r.skipped).toBeUndefined();
      starts.push(ti.calls.at(-1)!.searchParams.get("start_time")!);
    }
    // 30 days in 7-day windows: five calls for the first load, then the incremental call with a 5-minute overlap.
    expect(starts.slice(0, 5).map((s) => s.slice(0, 11))).toEqual(["19-Oct-2026", "26-Oct-2026", "02-Nov-2026", "09-Nov-2026", "16-Nov-2026"]);
    const c = (await cursorOf(org.id)).cursor as IndiaMartCursor;
    expect(c.windowStart).toBeUndefined();
    expect(c.lastSuccessTo).toBe(at(60).toISOString());
    expect(starts[5]).toBe(indiaMartTime(at(45))); // the run at 60 min starts 5 minutes before the end of the run at 50 min
    expect(await getDb().select().from(leads).where(eq(leads.orgId, org.id))).toHaveLength(1);

    // Calls are at least 5 minutes apart over the whole sequence.
    const runs = await getDb().select().from(syncRuns).where(eq(syncRuns.orgId, org.id));
    expect(runs.every((r) => r.status === "ok")).toBe(true);
  });

  it("a rejected key needs a new key; 'too many requests' waits without counting as a failure; the key never leaks", async () => {
    const { org } = await connected();
    const sys = systemCtx(org.id);
    const tooMany = fakePull(undefined, { CODE: 429, MESSAGE: "It is advised to hit this API once in every 5 minutes" });
    const r1 = await syncIndiaMart(sys, { fetchImpl: tooMany.f, now: NOW });
    expect(r1.errorMessages.join()).toMatch(/asked to wait/);
    let integ = await cursorOf(org.id);
    expect(integ).toMatchObject({ consecutiveFailures: 0 });
    expect(integ.backoffUntil!.getTime()).toBe(NOW.getTime() + 15 * 60_000);

    const rejected = fakePull(undefined, { CODE: 401, MESSAGE: "Key has expired" });
    await syncIndiaMart(sys, { fetchImpl: rejected.f, now: at(20) });
    integ = await cursorOf(org.id);
    expect(integ.status).toBe("reauth_required");
    expect(await syncIndiaMart(sys, { fetchImpl: rejected.f, now: at(40) })).toMatchObject({ skipped: expect.stringMatching(/new key/) });
    const everything = JSON.stringify([await getDb().select().from(syncRuns), await getDb().select().from(auditLogs), integ]);
    expect(everything).not.toContain(KEY);
  });
});

describe("one lead, one record; API versus email (G-SRC-6, G-SRC-7, G-SRC-8)", () => {
  it("the same enquiry by notification email and by API is one lead, counted once in each route", async () => {
    const { org, ctx } = await setupOrgWithUser("owner");
    const { url } = await createIndiaMartPushAddress(ctx, {});
    const secret = url.split("/").pop()!;
    const sys = systemCtx(org.id);
    const now = new Date();
    const queryTime = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");
    // The notification email arrives first (no IndiaMART id in it), then the API copy of the same enquiry.
    await withSystemTx((tx) => upsertLeadInternal(tx, sys, { source: "indiamart", sourceRef: "gmail:m-401", channel: "indiamart_enquiry", phone: "+919000000401", productText: "Sample Protein Isolate", receivedAt: now }));
    await receiveIndiaMartPush(secret, push(lead({ QUERY_TIME: queryTime(now) })));
    // A Buy Lead bought on IndiaMART, by API only; and an email-only enquiry.
    await receiveIndiaMartPush(secret, push(lead({ UNIQUE_QUERY_ID: "2600000402", QUERY_TYPE: "B", SENDER_MOBILE: "+91-9000000402", SENDER_EMAIL: "", QUERY_TIME: queryTime(now) })));
    await withSystemTx((tx) => upsertLeadInternal(tx, sys, { source: "indiamart", sourceRef: "gmail:m-403", channel: "indiamart_enquiry", phone: "+919000000403", productText: "Other Product", receivedAt: now }));

    const all = await getDb().select().from(leads).where(eq(leads.orgId, org.id));
    expect(all).toHaveLength(3);
    const merged = all.find((l) => l.phone === "+919000000401")!;
    expect(merged.sourceRef).toBe("2600000001");
    expect(merged.channel).toBe("indiamart_api_w");
    expect(merged.alternateRefs.map((r) => r.source)).toEqual(["indiamart_enquiry"]);
    expect(all.find((l) => l.phone === "+919000000402")!.channel).toBe("indiamart_api_b");

    const [im] = await withSystemTx((tx) => arrivalRoutesInternal(tx, org.id, startOfTodayIST()));
    expect(im).toEqual({ portal: "indiamart", total: 3, api: 2, email: 2, onlyApi: 1, onlyEmail: 1 });
  });
});

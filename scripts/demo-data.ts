/**
 * LOCAL DEMO DATA ONLY. Loads the anonymised email fixtures through the real ingest pipeline
 * (parsers → classification → leads), plus a few buy-lead decisions, so every screen has content.
 * Refuses to run against anything but a localhost database.
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/inquira_dev npm run demo:data
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { withSystemTx, closeDb } from "@/db/client";
import { listOrgIdsInternal, getIntegrationInternal, updateIntegrationInternal } from "@/modules/core/service";
import { ingestMessageInternal } from "@/modules/email/service";
import { logBuyleadDecision } from "@/modules/buyleads/service";
import { listLeads, updateLeadStatus, addLeadNote } from "@/modules/leads/service";
import type { Ctx } from "@/modules/core/types";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing: demo data is for a local database only (DATABASE_URL must point at localhost).");
  process.exit(1);
}

type Fixture = { id: string; from: string; to: string[]; subject: string; date: string; text: string | null; html: string | null; headers?: Record<string, string>; labels?: string[] };

try {
  const [orgId] = await withSystemTx((tx) => listOrgIdsInternal(tx));
  if (!orgId) throw new Error("No organisation. Run npm run db:seed first.");
  const ctx: Ctx = { orgId, actor: { kind: "system", job: "demo-data" } };
  const dir = path.join(process.cwd(), "fixtures/emails");
  const now = Date.now();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let i = 0;
  for (const f of files) {
    const fx = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Fixture;
    const from = fx.from.match(/<([^>]+)>/)?.[1] ?? fx.from;
    const fromName = fx.from.includes("<") ? fx.from.replace(/<[^>]+>/, "").trim() : null;
    // Spread over the last ~30 hours so "today" and relative times look realistic.
    const receivedAt = new Date(now - (i++ * 105 + 7) * 60_000);
    const r = await withSystemTx((tx) => ingestMessageInternal(tx, ctx, {
      gmailMessageId: `demo-${fx.id}`, gmailThreadId: `demo-thread-${fx.id}`, rfcMessageId: `<demo-${fx.id}@mail.example>`,
      fromEmail: from.toLowerCase(), fromName, toEmails: fx.to, ccEmails: [], subject: fx.subject, snippet: (fx.text ?? "").slice(0, 120),
      text: fx.text, html: fx.html, labelIds: fx.labels ?? ["INBOX"], headers: fx.headers ?? {}, receivedAt,
    }, { ownAddresses: ["sales@seller.example"] }));
    console.log(`${fx.id.padEnd(36)} → ${r.duplicate ? "already loaded" : r.classification}${r.leadCreated ? " (lead)" : ""}`);
  }
  await withSystemTx(async (tx) => {
    const g = await getIntegrationInternal(tx, orgId, "gmail");
    await updateIntegrationInternal(tx, ctx, g.id, { status: "not_connected" });
  });
  const leads = await listLeads(ctx, { pageSize: 50, international: "all" });
  const first = leads.items.find((l) => !l.isInternational && l.status === "new");
  if (first) {
    await updateLeadStatus(ctx, { leadId: first.id, status: "contacted", reason: "Called; wants COA and rate" });
    await addLeadNote(ctx, { leadId: first.id, body: "Spoke on phone. Needs sample of 200 g first." });
  }
  for (const d of [
    { lead_title: "Pea Protein Isolate 500 kg, Pune", product: "Pea Protein Isolate", location: "Pune, MH", quantity: "500 kg", decision: "would_contact" as const, reason: "Matches pea protein; Maharashtra; qty in range" },
    { lead_title: "Potato starch production plant", product: "Potato Starch", location: "Sidhpur, GJ", decision: "skipped" as const, reason: "Excluded term: production plant" },
  ]) await logBuyleadDecision(ctx, d);
  console.log("Demo data loaded.");
} finally {
  await closeDb();
}

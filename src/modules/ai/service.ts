/**
 * The AI layer (GOAL section 3, G-AI-1 to G-AI-10; ADR-031).
 *
 * Settings: each tier (Basic, Advanced) is one integration row (`ai_basic`, `ai_advanced`) holding provider,
 * model, address, threshold and daily limit; its key is encrypted in integration_secrets like every other key.
 *
 * Work: the `ai.work` job takes leads and review emails the rules could not settle and walks the order of
 * escalation: rules → Basic → Advanced → review queue. A tier is skipped when it is off, has no key, is
 * backing off after an error, or has used its daily calls; the item then moves to the next step at once, so
 * an outage delays nothing by more than one run and loses nothing. Model replies are schema-checked, and only
 * code writes to a lead or email, as actor `ai:<tier>`. Every decision is logged in ai_decisions.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { withSystemTx, type Tx } from "@/db/client";
import { AppError } from "@/lib/errors";
import { startOfTodayIST } from "@/lib/format";
import { audit } from "@/modules/core/audit";
import {
  findIntegrationInternal, getIntegrationInternal, getOrgSettingsInternal, readSecretsInternal, recordIntegrationFailure, recordIntegrationSuccess,
  updateIntegrationInternal, writeSecretsInternal, type Provider,
} from "@/modules/core/service";
import { defineExternalService, defineService } from "@/modules/core/service-kit";
import type { Ctx } from "@/modules/core/types";
import { productMatcherCatalog, productNameById } from "@/modules/catalog/service";
import {
  countLeadsAwaitingUnderstandingInternal, fillLeadDetailsInternal, leadsAwaitingUnderstandingInternal, markLeadUnderstoodInternal, openFields,
  type Lead,
} from "@/modules/leads/service";
import { intentByRules, quantityToKg } from "@/modules/leads/understanding";
import { classifyEmailInternal, markEmailAiCheckedInternal, reviewEmailsAwaitingAiInternal, type EmailRow } from "@/modules/email/service";
import { PROVIDERS, PROVIDER_LABELS } from "./providers";
import { AiProviderError, type AiProvider } from "./providers/types";
import { redactForBasic } from "./redact";
import { aiDecisions } from "./schema";
import { emailPrompt, emailReplySchema, leadPrompt, leadReplySchema, parseReply, EMAIL_SCHEMA, LEAD_SCHEMA, type LeadReply } from "./tasks";
import { AI_DEFAULTS, AI_PROVIDERS, AI_TIERS, TIER_INTEGRATION, type AiOutcome, type AiTask, type AiTier, type AiTierConfig, type LeadUnderstandingField } from "./types";

/** The job stops starting new calls after this long; one call may take CALL_TIMEOUT_MS more (tick limit 60 s). */
const RUN_BUDGET_MS = 15_000;
const CALL_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_RUN = 10;
/** Leads and emails older than this are left to people; AI is for what arrives now. */
const LOOKBACK_DAYS = 7;
const REQUIREMENT_CHARS = 1500;
const EMAIL_BODY_CHARS = 6000;

// ---------- settings ----------

const configSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().max(300).nullable().default(null),
  threshold: z.number().min(0.5).max(1),
  dailyLimit: z.number().int().min(0).max(100_000),
});

function readConfig(raw: Record<string, unknown>): AiTierConfig | null {
  const r = configSchema.safeParse(raw);
  return r.success ? r.data : null;
}

const baseUrlInput = z.string().trim().max(300).refine((u) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}, "Use an https:// address (http:// only for a model running on this computer)");

export const saveAiTierInput = z.object({
  tier: z.enum(AI_TIERS),
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1, "Enter the model name").max(100).regex(/^[A-Za-z0-9._:/@-]+$/, "Model names have no spaces"),
  baseUrl: baseUrlInput.optional().or(z.literal("")),
  threshold: z.number().min(0.5, "At least 0.5").max(1, "At most 1"),
  dailyLimit: z.number().int().min(0).max(100_000),
  /** Empty or missing keeps the saved key. */
  apiKey: z.string().trim().max(500).optional(),
});

/** Settings → AI: both tiers, without keys (only whether one is saved), with today's usage. */
export const getAiSettings = defineService({
  name: "ai.getSettings",
  input: z.object({}).default({}),
  permission: "integrations.read",
  runAs: "system",
  handler: async (ctx, _i, tx) => {
    const since = startOfTodayIST();
    const tiers = [];
    for (const tier of AI_TIERS) {
      const row = await findIntegrationInternal(tx, ctx.orgId, TIER_INTEGRATION[tier] as Provider);
      const cfg = row ? readConfig(row.config) : null;
      const hasKey = row ? !!(await readSecretsInternal<{ apiKey?: string }>(tx, row.id))?.apiKey : false;
      tiers.push({
        tier,
        enabled: !!row?.enabled && !!cfg && hasKey,
        hasKey,
        provider: cfg?.provider ?? (tier === "basic" ? "gemini" : "anthropic"),
        model: cfg?.model ?? "",
        baseUrl: cfg?.baseUrl ?? "",
        threshold: cfg?.threshold ?? AI_DEFAULTS.threshold,
        dailyLimit: cfg?.dailyLimit ?? AI_DEFAULTS.dailyLimit[tier],
        status: row?.status ?? "not_connected",
        lastError: row?.lastError ?? null,
        lastErrorAt: row?.lastErrorAt ?? null,
        lastSuccessAt: row?.lastSuccessAt ?? null,
        backoffUntil: row?.backoffUntil && row.backoffUntil > new Date() ? row.backoffUntil : null,
        usedToday: await callsSinceInternal(tx, ctx.orgId, tier, since),
      });
    }
    const providers = AI_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABELS[id], needsBaseUrl: PROVIDERS[id].needsBaseUrl }));
    return { tiers, providers, waitingLeads: await countLeadsAwaitingUnderstandingInternal(tx, ctx.orgId, LOOKBACK_DAYS) };
  },
});

export const saveAiTier = defineService({
  name: "ai.saveTier",
  input: saveAiTierInput,
  permission: "integrations.manage",
  runAs: "system",
  handler: async (ctx, input, tx) => {
    if (PROVIDERS[input.provider].needsBaseUrl && !input.baseUrl) {
      throw new AppError("VALIDATION", "Enter the provider's address", { fieldErrors: { baseUrl: ["Required for an OpenAI-compatible provider"] } });
    }
    const integ = await getIntegrationInternal(tx, ctx.orgId, TIER_INTEGRATION[input.tier] as Provider);
    const config: AiTierConfig = {
      provider: input.provider, model: input.model, baseUrl: input.baseUrl || null, threshold: input.threshold, dailyLimit: input.dailyLimit,
    };
    if (input.apiKey) await writeSecretsInternal(tx, ctx, integ, { apiKey: input.apiKey });
    const hasKey = !!(await readSecretsInternal<{ apiKey?: string }>(tx, integ.id))?.apiKey;
    if (input.enabled && !hasKey) throw new AppError("VALIDATION", "Paste the API key before turning this tier on", { fieldErrors: { apiKey: ["Required"] } });
    const changedProvider = JSON.stringify(readConfig(integ.config)) !== JSON.stringify(config) || !!input.apiKey;
    await updateIntegrationInternal(tx, ctx, integ.id, {
      config: { ...integ.config, ...config },
      enabled: input.enabled,
      status: !hasKey ? "not_connected" : changedProvider ? "configured" : integ.status,
      // New settings or a new key get a fresh start: no waiting on an old error.
      ...(changedProvider ? { backoffUntil: null, consecutiveFailures: 0, lastError: null, lastErrorAt: null } : {}),
    }, "ai.settings_update");
    return { ok: true, hasKey };
  },
});

/** Deletes the tier's key and turns it off. */
export const removeAiKey = defineService({
  name: "ai.removeKey",
  input: z.object({ tier: z.enum(AI_TIERS) }),
  permission: "integrations.manage",
  runAs: "system",
  handler: async (ctx, input, tx) => {
    const integ = await findIntegrationInternal(tx, ctx.orgId, TIER_INTEGRATION[input.tier] as Provider);
    if (!integ) return { ok: true };
    await writeSecretsInternal(tx, ctx, integ, { apiKey: null });
    await updateIntegrationInternal(tx, ctx, integ.id, { enabled: false, status: "not_connected", backoffUntil: null, consecutiveFailures: 0 }, "ai.key_removed");
    return { ok: true };
  },
});

/** One small call with fixed text (no company or buyer data) to check key, model and address. */
export const testAiTier = defineExternalService({
  name: "ai.testTier",
  input: z.object({ tier: z.enum(AI_TIERS) }),
  permission: "integrations.manage",
  handler: (ctx, input) => testAiTierInternal(ctx, input.tier),
});

export async function testAiTierInternal(ctx: Ctx, tier: AiTier, fetchImpl: typeof fetch = fetch) {
  const loaded = await withSystemTx((tx) => loadTierInternal(tx, ctx.orgId, tier, { requireEnabled: false }));
  if (!loaded) throw new AppError("VALIDATION", "Save a provider, model and key first");
  const provider = providerFor(loaded, fetchImpl);
  try {
    const r = await provider.complete({
      system: "You check that a connection works. Answer only with JSON.",
      user: 'Reply with {"ok": true} as JSON matching this schema: {"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}',
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      maxOutputTokens: 1024,
    });
    const ok = parseReply(z.object({ ok: z.boolean() }), r.text)?.ok === true;
    await withSystemTx((tx) => recordIntegrationSuccess(tx, ctx, loaded.integration, { status: "connected", lastError: null, lastErrorAt: null }));
    return { ok: true, followedFormat: ok, message: ok ? "Connected. The model answered in the expected format." : "Connected, but the model did not answer in the expected format. Try another model." };
  } catch (e) {
    const msg = e instanceof AiProviderError ? e.message : "The test failed";
    await withSystemTx((tx) => recordIntegrationFailure(tx, ctx, loaded.integration, msg, { reauth: e instanceof AiProviderError && e.kind === "auth" }));
    return { ok: false, followedFormat: false, message: msg };
  }
}

// ---------- accuracy (G-AI-9) ----------

/** Per tier over the last `days` days: calls, fields filled, how many a person corrected, and the rest. */
export async function aiAccuracyInternal(tx: Tx, orgId: string, days: number) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await tx.select({
    tier: aiDecisions.tier,
    calls: sql<number>`count(distinct ${aiDecisions.callId})::int`,
    applied: sql<number>`count(*) filter (where ${aiDecisions.outcome} = 'applied')::int`,
    corrected: sql<number>`count(*) filter (where ${aiDecisions.outcome} = 'applied' and ${aiDecisions.correctedAt} is not null)::int`,
    notConfident: sql<number>`count(*) filter (where ${aiDecisions.outcome} = 'not_confident')::int`,
    invalid: sql<number>`count(*) filter (where ${aiDecisions.outcome} = 'invalid')::int`,
    errors: sql<number>`count(distinct ${aiDecisions.callId}) filter (where ${aiDecisions.outcome} = 'error')::int`,
  }).from(aiDecisions)
    .where(and(eq(aiDecisions.orgId, orgId), gte(aiDecisions.createdAt, since)))
    .groupBy(aiDecisions.tier);
  const on = new Map<AiTier, boolean>();
  for (const tier of AI_TIERS) on.set(tier, !!(await findIntegrationInternal(tx, orgId, TIER_INTEGRATION[tier] as Provider))?.enabled);
  return AI_TIERS.map((tier) => {
    const r = rows.find((x) => x.tier === tier) ?? { calls: 0, applied: 0, corrected: 0, notConfident: 0, invalid: 0, errors: 0 };
    return { tier, enabled: on.get(tier)!, ...r, accuracy: r.applied ? (r.applied - r.corrected) / r.applied : null };
  });
}

export const getAiAccuracy = defineService({
  name: "ai.accuracy",
  input: z.object({ days: z.number().int().min(1).max(365).default(30) }).default({ days: 30 }),
  permission: "dashboard.read",
  handler: (ctx, input, tx) => aiAccuracyInternal(tx, ctx.orgId, input.days),
});

/** AI decisions about one lead or email, newest first (shown on the lead page). */
export async function decisionsForInternal(tx: Tx, orgId: string, entityType: "lead" | "email_message", entityId: string) {
  return tx.select().from(aiDecisions)
    .where(and(eq(aiDecisions.orgId, orgId), eq(aiDecisions.entityType, entityType), eq(aiDecisions.entityId, entityId)))
    .orderBy(sql`${aiDecisions.createdAt} desc`).limit(20);
}

// ---------- the job ----------

type LoadedTier = { tier: AiTier; config: AiTierConfig; apiKey: string; integration: Awaited<ReturnType<typeof getIntegrationInternal>>; usedToday: number };

async function callsSinceInternal(tx: Tx, orgId: string, tier: AiTier, since: Date): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(distinct ${aiDecisions.callId})::int` }).from(aiDecisions)
    .where(and(eq(aiDecisions.orgId, orgId), eq(aiDecisions.tier, tier), gte(aiDecisions.createdAt, since)));
  return r?.n ?? 0;
}

async function loadTierInternal(tx: Tx, orgId: string, tier: AiTier, opts: { requireEnabled: boolean }): Promise<LoadedTier | null> {
  const integration = await findIntegrationInternal(tx, orgId, TIER_INTEGRATION[tier] as Provider);
  if (!integration || (opts.requireEnabled && !integration.enabled)) return null;
  const config = readConfig(integration.config);
  const apiKey = (await readSecretsInternal<{ apiKey?: string }>(tx, integration.id))?.apiKey;
  if (!config || !apiKey) return null;
  return { tier, config, apiKey, integration, usedToday: await callsSinceInternal(tx, orgId, tier, startOfTodayIST()) };
}

function providerFor(t: LoadedTier, fetchImpl: typeof fetch): AiProvider {
  return PROVIDERS[t.config.provider].create({ model: t.config.model, apiKey: t.apiKey, baseUrl: t.config.baseUrl, fetch: fetchImpl, timeoutMs: CALL_TIMEOUT_MS });
}

/** Why a tier cannot take a call right now, or null when it can. */
function unavailable(t: LoadedTier, now: Date): string | null {
  if (t.integration.backoffUntil && t.integration.backoffUntil > now) return "backing off after an error";
  if (t.usedToday >= t.config.dailyLimit) return "daily limit reached";
  return null;
}

type DecisionRow = { task: AiTask; outcome: AiOutcome; confidence?: number | null; value?: unknown; detail?: string | null };

async function logDecisions(tx: Tx, orgId: string, t: LoadedTier, call: { id: string; entityType: "lead" | "email_message"; entityId: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null }, rows: DecisionRow[]) {
  if (!rows.length) return;
  await tx.insert(aiDecisions).values(rows.map((r) => ({
    orgId, callId: call.id, task: r.task, tier: t.tier, provider: t.config.provider, model: t.config.model,
    entityType: call.entityType, entityId: call.entityId, outcome: r.outcome,
    confidence: r.confidence === null || r.confidence === undefined ? null : r.confidence.toFixed(3),
    value: (r.value ?? null) as object | null, detail: r.detail?.slice(0, 500) ?? null,
    latencyMs: call.latencyMs, inputTokens: call.inputTokens, outputTokens: call.outputTokens, createdBy: `ai:${t.tier}`,
  })));
}

/** Provider failures make the tier back off (G-AI-7); a refusal or a cut-off reply is about this item only. */
async function recordProviderError(ctx: Ctx, t: LoadedTier, e: AiProviderError) {
  if (e.kind === "refused" || e.kind === "truncated") return;
  const row = await withSystemTx((tx) => recordIntegrationFailure(tx, ctx, t.integration, e.message, { reauth: e.kind === "auth" }));
  t.integration = row;
}

export type AiWorkOptions = { fetchImpl?: typeof fetch; now?: () => Date; budgetMs?: number; maxItems?: number };

/**
 * The `ai.work` job for one company. Returns `{ more: true }` when it stopped with work left, so the job
 * runner queues a follow-up. Safe to run with every tier off: leads then get rules only and go to review.
 */
export async function runAiWork(ctx: Ctx, opts: AiWorkOptions = {}) {
  const started = Date.now();
  const now = opts.now ?? (() => new Date());
  const budget = opts.budgetMs ?? RUN_BUDGET_MS;
  const maxItems = opts.maxItems ?? MAX_ITEMS_PER_RUN;
  const f = opts.fetchImpl ?? fetch;
  const tiers = await withSystemTx(async (tx) => {
    const out: LoadedTier[] = [];
    for (const tier of AI_TIERS) {
      const t = await loadTierInternal(tx, ctx.orgId, tier, { requireEnabled: true });
      if (t) out.push(t);
    }
    return out;
  });
  const stats = { leads: 0, emails: 0, calls: 0, applied: 0, more: false };

  const pending = await withSystemTx((tx) => leadsAwaitingUnderstandingInternal(tx, ctx.orgId, { limit: maxItems + 1, days: LOOKBACK_DAYS }));
  for (const lead of pending.slice(0, maxItems)) {
    if (Date.now() - started > budget) { stats.more = true; break; }
    await understandLead(ctx, lead, tiers, f, now, stats);
    stats.leads++;
  }
  if (pending.length > maxItems) stats.more = true;

  const advanced = tiers.find((t) => t.tier === "advanced");
  if (advanced && !stats.more) {
    const emails = await withSystemTx((tx) => reviewEmailsAwaitingAiInternal(tx, ctx.orgId, { limit: maxItems + 1, days: LOOKBACK_DAYS }));
    for (const email of emails.slice(0, maxItems)) {
      if (Date.now() - started > budget) { stats.more = true; break; }
      // A tier that cannot take calls leaves the email unchecked, so it is tried when the tier is back.
      if (unavailable(advanced, now())) break;
      await classifyEmailWithAi(ctx, email, advanced, f, stats);
      stats.emails++;
    }
    if (emails.length > maxItems && !unavailable(advanced, now())) stats.more = true;
  }
  // Leads created while this run classified emails could not queue their own run (the job held its key).
  if (!stats.more && (await withSystemTx((tx) => countLeadsAwaitingUnderstandingInternal(tx, ctx.orgId, LOOKBACK_DAYS))) > 0) stats.more = true;
  return stats;
}

async function understandLead(ctx: Ctx, lead: Lead, tiers: LoadedTier[], f: typeof fetch, now: () => Date, stats: { calls: number; applied: number }) {
  // 1. Rules (leads that arrived before the rules existed, or that a merge filled later).
  const ruled = intentByRules(lead);
  const kg = quantityToKg(lead.quantityText);
  if ((ruled && !lead.intent) || (kg && !lead.quantityKg)) {
    await withSystemTx((tx) => fillLeadDetailsInternal(tx, ctx, lead.id, { intent: ruled?.intent, quantityKg: kg ? Number(kg) : undefined }, { intent: ruled?.by, quantity: "rule:units" }));
  }
  let open = openFields({ ...lead, intent: lead.intent ?? ruled?.intent ?? null, quantityKg: lead.quantityKg ?? kg });

  // 2. Basic, then Advanced, for whatever is still open.
  for (const t of tiers) {
    if (!open.length) break;
    if (unavailable(t, now())) continue;
    const context = await withSystemTx(async (tx) => ({
      catalogue: await productMatcherCatalog(tx, ctx.orgId),
    }));
    // Stable refs (P1, P2, …) by name: short, and a model cannot invent a database id.
    const refs = [...context.catalogue].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((c, i) => ({ ref: `P${i + 1}`, id: c.id, name: c.name, aliases: c.aliases }));
    const known = {
      names: [lead.contactName], companies: [lead.companyName], places: [lead.city], emails: [lead.email], phones: [lead.phone],
    };
    const subject = (lead.rawPayload as { email?: { subject?: string | null } } | null)?.email?.subject ?? "";
    const prompt = leadPrompt({
      productText: redactForBasic(lead.productText, known),
      quantityText: redactForBasic(lead.quantityText, known),
      subject: redactForBasic(subject, known),
      requirement: redactForBasic((lead.message ?? "").slice(0, REQUIREMENT_CHARS), known),
      catalogue: refs.map(({ ref, name, aliases }) => ({ ref, name, aliases })),
    });
    const callId = randomUUID();
    const t0 = Date.now();
    t.usedToday++;
    stats.calls++;
    let reply: LeadReply | null = null;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    try {
      const r = await providerFor(t, f).complete({ ...prompt, schema: LEAD_SCHEMA, maxOutputTokens: 2048 });
      usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
      reply = parseReply(leadReplySchema, r.text);
    } catch (e) {
      if (!(e instanceof AiProviderError)) throw e;
      await withSystemTx((tx) => logDecisions(tx, ctx.orgId, t, { id: callId, entityType: "lead", entityId: lead.id, latencyMs: Date.now() - t0, ...usage },
        open.map((field) => ({ task: TASK_OF[field], outcome: e.kind === "refused" || e.kind === "truncated" ? "invalid" : "error", detail: `${e.kind}: ${e.message}` }))));
      await recordProviderError(ctx, t, e);
      continue; // the lead moves on to the next tier (G-AI-7)
    }
    const latencyMs = Date.now() - t0;
    const aiCtx: Ctx = { orgId: ctx.orgId, actor: { kind: "ai", tier: t.tier } };
    const decided = judgeLeadReply(reply, open, refs, t.config.threshold);
    const written = await withSystemTx(async (tx) => {
      const found = decided.found;
      if (found.productId && !(await productNameById(tx, ctx.orgId, found.productId))) delete found.productId;
      const w = await fillLeadDetailsInternal(tx, aiCtx, lead.id, found, `ai:${t.tier}`);
      const rows = decided.rows.map((r) => (r.outcome === "applied" && !w.includes(FIELD_OF[r.task]!) ? { ...r, outcome: "not_confident" as const, detail: "Already filled by someone else" } : r));
      await logDecisions(tx, ctx.orgId, t, { id: callId, entityType: "lead", entityId: lead.id, latencyMs, ...usage }, rows);
      await recordIntegrationSuccess(tx, ctx, t.integration, { status: "connected" });
      return w;
    });
    stats.applied += written.length;
    open = open.filter((x) => !written.includes(x));
  }

  // 3. Whatever is still open waits for a person or the Claude connector (Leads → Needs details).
  await withSystemTx((tx) => markLeadUnderstoodInternal(tx, ctx.orgId, lead.id));
}

const TASK_OF: Record<LeadUnderstandingField, AiTask> = { product: "lead.product", intent: "lead.intent", quantity: "lead.quantity" };
const FIELD_OF: Partial<Record<AiTask, LeadUnderstandingField>> = { "lead.product": "product", "lead.intent": "intent", "lead.quantity": "quantity" };

/**
 * Code decides (AGENTS rule 9): a field is accepted only when the reply passed the schema, the field was
 * open, the model gave a value, its confidence reaches the threshold and the value exists (a product ref
 * from the list sent). Everything else is logged and changes nothing.
 */
export function judgeLeadReply(reply: LeadReply | null, open: LeadUnderstandingField[], refs: { ref: string; id: string }[], threshold: number) {
  const rows: DecisionRow[] = [];
  const found: { productId?: string; intent?: NonNullable<LeadReply["intent"]["value"]>; quantityKg?: number } = {};
  if (!reply) {
    for (const f of open) rows.push({ task: TASK_OF[f], outcome: "invalid", detail: "The reply did not match the required format" });
    return { rows, found };
  }
  if (open.includes("product")) {
    const { ref, confidence } = reply.product;
    const hit = ref ? refs.find((r) => r.ref === ref) : null;
    if (!ref) rows.push({ task: "lead.product", outcome: "not_confident", confidence, detail: "The model did not recognise a catalogue product" });
    else if (!hit) rows.push({ task: "lead.product", outcome: "invalid", confidence, value: ref, detail: "Not a product from the list" });
    else if (confidence < threshold) rows.push({ task: "lead.product", outcome: "not_confident", confidence, value: hit.id });
    else { rows.push({ task: "lead.product", outcome: "applied", confidence, value: hit.id }); found.productId = hit.id; }
  }
  if (open.includes("intent")) {
    const { value, confidence } = reply.intent;
    if (!value) rows.push({ task: "lead.intent", outcome: "not_confident", confidence, detail: "The model could not tell" });
    else if (confidence < threshold) rows.push({ task: "lead.intent", outcome: "not_confident", confidence, value });
    else { rows.push({ task: "lead.intent", outcome: "applied", confidence, value }); found.intent = value; }
  }
  if (open.includes("quantity")) {
    const { kg, confidence } = reply.quantity;
    if (kg === null) rows.push({ task: "lead.quantity", outcome: "not_confident", confidence, detail: "The model found no weight" });
    else if (confidence < threshold) rows.push({ task: "lead.quantity", outcome: "not_confident", confidence, value: kg });
    else { rows.push({ task: "lead.quantity", outcome: "applied", confidence, value: Math.round(kg * 1000) / 1000 }); found.quantityKg = kg; }
  }
  return { rows, found };
}

async function classifyEmailWithAi(ctx: Ctx, email: EmailRow, t: LoadedTier, f: typeof fetch, stats: { calls: number; applied: number }) {
  const { settings, catalogue } = await withSystemTx(async (tx) => ({
    settings: await getOrgSettingsInternal(tx, ctx.orgId), catalogue: await productMatcherCatalog(tx, ctx.orgId),
  }));
  const prompt = emailPrompt({
    fromName: email.fromName ?? "", fromEmail: email.fromEmail ?? "", subject: email.subject ?? "",
    body: (email.bodyText ?? email.snippet ?? "").slice(0, EMAIL_BODY_CHARS), homeCountry: settings.homeCountry,
    productNames: catalogue.map((c) => c.name),
  });
  const callId = randomUUID();
  const t0 = Date.now();
  t.usedToday++;
  stats.calls++;
  const call = (usage: { inputTokens: number | null; outputTokens: number | null }) => ({ id: callId, entityType: "email_message" as const, entityId: email.id, latencyMs: Date.now() - t0, ...usage });
  let text: string;
  let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
  try {
    const r = await providerFor(t, f).complete({ ...prompt, schema: EMAIL_SCHEMA, maxOutputTokens: 4096 });
    text = r.text;
    usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  } catch (e) {
    if (!(e instanceof AiProviderError)) throw e;
    await withSystemTx(async (tx) => {
      await logDecisions(tx, ctx.orgId, t, call(usage), [{ task: "email.classify", outcome: e.kind === "refused" || e.kind === "truncated" ? "invalid" : "error", detail: `${e.kind}: ${e.message}` }]);
      // The email stays in review for a person; it is only retried after a rate limit or outage.
      if (e.kind === "refused" || e.kind === "truncated" || e.kind === "bad_request") await markEmailAiCheckedInternal(tx, ctx.orgId, email.id);
    });
    await recordProviderError(ctx, t, e);
    return;
  }
  const reply = parseReply(emailReplySchema, text);
  const aiCtx: Ctx = { orgId: ctx.orgId, actor: { kind: "ai", tier: t.tier } };
  const confident = !!reply?.classification && reply.confidence >= t.config.threshold;
  const outcome: AiOutcome = !reply ? "invalid" : confident ? "applied" : "not_confident";
  const toInput = (confidence: "high" | "low") => ({
    emailId: email.id, classification: reply!.classification!, confidence, reason: `AI (${t.tier}): ${reply!.reason}`,
    lead: {
      contactName: reply!.lead.contact_name ?? undefined, companyName: reply!.lead.company ?? undefined, phone: reply!.lead.phone ?? undefined,
      email: reply!.lead.email ?? undefined, city: reply!.lead.city ?? undefined, state: reply!.lead.state ?? undefined,
      country: reply!.lead.country ?? undefined, productText: reply!.lead.product ?? undefined, quantityText: reply!.lead.quantity ?? undefined,
    },
  });
  let detail: string | null = reply?.reason ?? "The reply did not match the required format";
  let finalOutcome = outcome;
  if (reply?.classification) {
    try {
      await withSystemTx((tx) => classifyEmailInternal(tx, aiCtx, toInput(confident ? "high" : "low")));
      if (confident) stats.applied++;
    } catch (e) {
      // For example "conversation" with no lead to attach it to: keep it as a suggestion for a person.
      if (!(e instanceof AppError)) throw e;
      finalOutcome = "not_confident";
      detail = `${e.message} (${reply.reason})`;
      await withSystemTx((tx) => classifyEmailInternal(tx, aiCtx, toInput("low")).catch(() => null));
    }
  }
  await withSystemTx(async (tx) => {
    await logDecisions(tx, ctx.orgId, t, call(usage), [{ task: "email.classify", outcome: finalOutcome, confidence: reply?.confidence ?? null, value: reply?.classification ?? null, detail }]);
    await markEmailAiCheckedInternal(tx, ctx.orgId, email.id);
    await recordIntegrationSuccess(tx, ctx, t.integration, { status: "connected" });
    await audit(tx, aiCtx, { action: "ai.email_checked", entityType: "email_message", entityId: email.id, changes: { outcome: finalOutcome, classification: reply?.classification ?? null, confidence: reply?.confidence ?? null } });
  });
}

/** Leads currently waiting for the AI job (for the dashboard). */
export async function aiBacklogInternal(tx: Tx, orgId: string) {
  return countLeadsAwaitingUnderstandingInternal(tx, orgId, LOOKBACK_DAYS);
}


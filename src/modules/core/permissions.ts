import { forbidden } from "@/lib/errors";
import type { Ctx, Role } from "./types";

export const PERMISSIONS = [
  "leads.read", "leads.edit", "leads.update_status", "leads.delete", "leads.create",
  "notes.write",
  "emails.read", "emails.classify",
  "quotes.create", "quotes.read",
  "catalog.read", "rates.write", "catalog.write",
  "templates.read", "templates.write",
  "rules.read", "rules.write",
  "settings.read", "settings.write",
  "integrations.read", "integrations.manage",
  "mcp_tokens.manage",
  "buylead.rules.read", "buylead.rules.write", "buylead.decisions.write", "buylead.decisions.read",
  "audit.read", "dashboard.read", "sync.run",
  "members.manage", "documents.read", "documents.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What every member can open, whatever their role or custom access: the screens a lead's work needs. */
export const BASE_PERMISSIONS: readonly Permission[] = [
  "dashboard.read", "leads.read", "emails.read", "quotes.read", "catalog.read", "documents.read", "templates.read", "rules.read",
  "buylead.rules.read", "buylead.decisions.read", "audit.read",
];

/**
 * Abilities an owner or admin can switch on or off for one member (Settings → Members → Access), on top of
 * the member's role. Every permission outside BASE_PERMISSIONS belongs to exactly one ability (a test checks
 * this), so a switch is all-or-nothing. `requires` names an ability that must be on too (the screen it lives on).
 */
export const ABILITIES = [
  { id: "work_leads", group: "Leads", label: "Work on leads: edit, change status, add notes, add a lead", perms: ["leads.edit", "leads.update_status", "notes.write", "leads.create"] },
  { id: "delete_leads", group: "Leads", label: "Delete leads", perms: ["leads.delete"] },
  { id: "review_emails", group: "Leads", label: "Sort unclear emails in the review queue", perms: ["emails.classify"] },
  { id: "create_quotes", group: "Quotations", label: "Create quotation drafts", perms: ["quotes.create"] },
  { id: "change_prices", group: "Rates and products", label: "Change prices and import price lists", perms: ["rates.write"] },
  { id: "edit_products", group: "Rates and products", label: "Add, edit and remove products", perms: ["catalog.write"] },
  { id: "manage_documents", group: "Documents", label: "Add and remove documents (COA, TDS, MSDS)", perms: ["documents.write"] },
  { id: "edit_templates", group: "Templates and rules", label: "Edit quotation and WhatsApp templates", perms: ["templates.write"] },
  { id: "edit_email_rules", group: "Templates and rules", label: "Edit email rules", perms: ["rules.write"], requires: "see_settings" },
  { id: "edit_buylead_rules", group: "Templates and rules", label: "Edit IndiaMART Buy Lead rules", perms: ["buylead.rules.write", "buylead.decisions.write"], requires: "see_settings" },
  { id: "see_settings", group: "Settings", label: "See settings", perms: ["settings.read", "integrations.read"] },
  { id: "change_settings", group: "Settings", label: "Change company settings (payment terms, validity, price basis)", perms: ["settings.write"], requires: "see_settings" },
  { id: "sync_now", group: "Settings", label: "Run a sync now", perms: ["sync.run"], requires: "see_settings" },
  { id: "manage_connections", group: "Settings", label: "Connect Gmail and TradeIndia", perms: ["integrations.manage"], requires: "see_settings" },
  { id: "manage_claude", group: "Settings", label: "Manage the Claude connector", perms: ["mcp_tokens.manage"], requires: "see_settings" },
  { id: "manage_members", group: "Settings", label: "Manage members and their access", perms: ["members.manage"], requires: "see_settings" },
] as const satisfies readonly { id: string; group: string; label: string; perms: readonly Permission[]; requires?: string }[];
export type AbilityId = (typeof ABILITIES)[number]["id"];
export const ABILITY_IDS = ABILITIES.map((a) => a.id) as [AbilityId, ...AbilityId[]];

const ability = (id: AbilityId): Permission[] => [...ABILITIES.find((a) => a.id === id)!.perms];
const READ: Permission[] = [...BASE_PERMISSIONS, ...ability("see_settings")];
const SALES: Permission[] = [...READ, ...ability("work_leads"), ...ability("review_emails"), ...ability("create_quotes"), ...ability("sync_now")];
const ADMIN: Permission[] = [...BASE_PERMISSIONS, ...ABILITIES.flatMap((a) => a.perms)];

/**
 * Default permissions per role. Owners always have everything (no custom access). QA looks after product
 * documents; Accounts sees leads, quotations and prices but not settings. Mirrored in SQL by
 * `app.role_default` (drizzle/0008); tests/roles.test.ts fails if the two differ.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ADMIN),
  admin: new Set(ADMIN),
  sales: new Set(SALES),
  qa: new Set([...READ, ...ability("manage_documents")]),
  accounts: new Set(BASE_PERMISSIONS),
  viewer: new Set(READ),
};

/** A member's effective permissions: the role's defaults, plus `granted`, minus `revoked`. Owners ignore both. */
export function permissionsFor(role: Role, granted: readonly string[] = [], revoked: readonly string[] = []): Set<Permission> {
  const s = new Set(ROLE_PERMISSIONS[role]);
  if (role === "owner") return s;
  for (const p of revoked) s.delete(p as Permission);
  for (const p of granted) if ((PERMISSIONS as readonly string[]).includes(p)) s.add(p as Permission);
  return s;
}

/** Which abilities are on for a member (an ability is on when all its permissions are). */
export function abilitiesFor(role: Role, granted: readonly string[] = [], revoked: readonly string[] = []): Set<AbilityId> {
  const perms = permissionsFor(role, granted, revoked);
  return new Set(ABILITIES.filter((a) => a.perms.every((p) => perms.has(p))).map((a) => a.id));
}

/** Adds the abilities that switched-on abilities need (for example "See settings" for "Change company settings"). */
export function withRequirements(on: Iterable<AbilityId>): Set<AbilityId> {
  const out = new Set(on);
  for (const a of ABILITIES) if (out.has(a.id) && "requires" in a && a.requires) out.add(a.requires as AbilityId);
  return out;
}

/** The overrides that give `role` exactly the abilities in `on` (with their requirements). */
export function overridesFor(role: Role, on: Iterable<AbilityId>): { granted: Permission[]; revoked: Permission[] } {
  if (role === "owner") return { granted: [], revoked: [] };
  const wanted = new Set<Permission>([...BASE_PERMISSIONS, ...[...withRequirements(on)].flatMap((id) => ability(id))]);
  const def = ROLE_PERMISSIONS[role];
  return {
    granted: PERMISSIONS.filter((p) => wanted.has(p) && !def.has(p)),
    revoked: PERMISSIONS.filter((p) => def.has(p) && !wanted.has(p)),
  };
}

/**
 * MCP tokens are deliberately narrow (brief §6.8): read, classify, update lead status/notes, fill a lead's
 * empty product, intent or quantity (the only tool with leads.edit is submit_lead_details), create quote
 * drafts, read/log buy-lead data. No deletes, no rates/settings, no credentials.
 */
export const MCP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "leads.read", "leads.update_status", "notes.write", "leads.edit",
  "emails.read", "emails.classify",
  "quotes.create", "quotes.read", "catalog.read", "templates.read", "rules.read",
  "buylead.rules.read", "buylead.decisions.write", "buylead.decisions.read", "dashboard.read",
]);

export function can(ctx: Ctx, perm: Permission): boolean {
  switch (ctx.actor.kind) {
    case "human":
      return permissionsFor(ctx.actor.role, ctx.actor.granted, ctx.actor.revoked).has(perm);
    case "mcp":
      return MCP_PERMISSIONS.has(perm);
    case "system":
      return true;
    case "ai":
      // AI advises, code decides (AGENTS rule 9): an AI actor passes no permission check, so it can call no
      // public service. The AI job applies schema-checked answers through internal functions only.
      return false;
  }
}

export function authorize(ctx: Ctx, perm: Permission): void {
  if (!can(ctx, perm)) throw forbidden(`Not allowed: ${perm}`);
}

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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = [
  "leads.read", "emails.read", "quotes.read", "catalog.read", "templates.read", "rules.read",
  "settings.read", "integrations.read", "buylead.rules.read", "buylead.decisions.read", "audit.read", "dashboard.read",
];
const SALES: Permission[] = [
  ...READ, "leads.edit", "leads.update_status", "leads.create", "notes.write", "emails.classify", "quotes.create", "sync.run",
];
const ADMIN: Permission[] = [
  ...SALES, "leads.delete", "rates.write", "catalog.write", "templates.write", "rules.write", "settings.write",
  "integrations.manage", "mcp_tokens.manage", "buylead.rules.write", "buylead.decisions.write",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ADMIN),
  admin: new Set(ADMIN),
  sales: new Set(SALES),
  viewer: new Set(READ),
};

/**
 * MCP tokens are deliberately narrow (brief §6.8): read, classify, update lead status/notes,
 * create quote drafts, read/log buy-lead data. No deletes, no rates/settings, no credentials.
 */
export const MCP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "leads.read", "leads.update_status", "notes.write",
  "emails.read", "emails.classify",
  "quotes.create", "quotes.read", "catalog.read", "templates.read", "rules.read",
  "buylead.rules.read", "buylead.decisions.write", "buylead.decisions.read", "dashboard.read",
]);

export function can(ctx: Ctx, perm: Permission): boolean {
  switch (ctx.actor.kind) {
    case "human":
      return ROLE_PERMISSIONS[ctx.actor.role].has(perm);
    case "mcp":
      return MCP_PERMISSIONS.has(perm);
    case "system":
      return true;
  }
}

export function authorize(ctx: Ctx, perm: Permission): void {
  if (!can(ctx, perm)) throw forbidden(`Not allowed: ${perm}`);
}

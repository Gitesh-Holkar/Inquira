export type Role = "owner" | "admin" | "sales" | "qa" | "accounts" | "viewer";

export type Actor =
  /** `granted` and `revoked` are this member's custom access on top of the role (Settings → Members → Access). */
  | { kind: "human"; userId: string; email: string; role: Role; granted?: readonly string[]; revoked?: readonly string[] }
  | { kind: "mcp"; tokenId: string; tokenName: string; scopes: string[] }
  | { kind: "system"; job: string }
  /** An AI tier's decision applied by code (src/modules/ai). AI actors call no public service. */
  | { kind: "ai"; tier: "basic" | "advanced" };

/** Every service call carries the org it acts on and who is acting. */
export type Ctx = { orgId: string; actor: Actor };

export function actorString(actor: Actor): string {
  switch (actor.kind) {
    case "human":
      return `human:${actor.userId}`;
    case "mcp":
      return `mcp:${actor.tokenName}`;
    case "system":
      return `system:${actor.job}`;
    case "ai":
      return `ai:${actor.tier}`;
  }
}

export const EVENT_TYPES = [
  "lead.created", "lead.updated", "lead.status_changed", "lead.note_added", "lead.duplicate_merged",
  "contact.created", "email.received", "email.classified", "quote.drafted", "quote.failed",
  "rate.updated", "product.created", "product.updated", "product.removed", "product.restored", "integration.connected", "integration.error", "integration.disconnected",
  "sync.completed", "buylead.decision_logged", "template.updated", "rule.created", "mcp.token_created", "mcp.token_revoked",
  "member.added", "member.updated", "member.removed", "document.added", "document.removed",
  "message.prepared", "message.sent", "message.failed", "message.cancelled", "settings.sending_changed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

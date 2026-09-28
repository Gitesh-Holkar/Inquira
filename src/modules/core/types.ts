export type Role = "owner" | "admin" | "sales" | "viewer";

export type Actor =
  | { kind: "human"; userId: string; email: string; role: Role }
  | { kind: "mcp"; tokenId: string; tokenName: string; scopes: string[] }
  | { kind: "system"; job: string };

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
  }
}

export const EVENT_TYPES = [
  "lead.created", "lead.updated", "lead.status_changed", "lead.note_added", "lead.duplicate_merged",
  "contact.created", "email.received", "email.classified", "quote.drafted", "quote.failed",
  "rate.updated", "product.created", "integration.connected", "integration.error", "integration.disconnected",
  "sync.completed", "buylead.decision_logged", "template.updated", "rule.created", "mcp.token_created", "mcp.token_revoked",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

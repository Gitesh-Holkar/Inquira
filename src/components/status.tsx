import { Badge, type Tone } from "@/components/ui/primitives";
import { SOURCE_LABELS, STATUS_LABELS, type LeadSource, type LeadStatus } from "@/modules/leads/types";

const STATUS_TONE: Record<LeadStatus, Tone> = {
  new: "info", contacted: "primary", quoted: "warning", negotiating: "warning", won: "success", lost: "danger", not_relevant: "neutral",
};
const STATUS_DOT: Record<LeadStatus, string> = {
  new: "●", contacted: "◐", quoted: "◑", negotiating: "◒", won: "✓", lost: "✕", not_relevant: "–",
};

/** Colour + symbol + text label — never colour alone (brief §7.8). */
export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden>{STATUS_DOT[status]}</span>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SourceBadge({ source, channel }: { source: LeadSource; channel?: string | null }) {
  const extra = channel === "indiamart_buylead" ? " · Buy lead" : channel === "tradeindia_api" ? " · API" : "";
  return <Badge tone="neutral">{SOURCE_LABELS[source]}{extra}</Badge>;
}

export const EMAIL_CLASS_LABEL: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  inquiry: { label: "Inquiry", tone: "success" },
  conversation: { label: "Conversation", tone: "info" },
  ignored: { label: "Ignored", tone: "neutral" },
  international: { label: "International", tone: "warning" },
  needs_review: { label: "Needs review", tone: "danger" },
};

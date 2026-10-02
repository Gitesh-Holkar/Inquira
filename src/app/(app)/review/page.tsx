import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { FREE_MAIL_DOMAINS, listEmailsNeedingReview, senderDomain } from "@/modules/email/service";
import { can } from "@/modules/core/permissions";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ReviewItem } from "@/components/review/review-item";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const s = await requireSession("emails.read");
  const q = await listEmailsNeedingReview(s.ctx, { limit: 25, bodyChars: 4000 });
  return (
    <>
      <PageHeader title="Review queue" description={`${q.total} email${q.total === 1 ? "" : "s"} the parsers couldn't classify. Claude works through these via MCP; low-confidence ones wait here for you.`} />
      {q.items.length === 0 ? (
        <Card><EmptyState icon={<CheckCircle2 />} title="All caught up">Nothing waits for review. New direct inquiries land here when the rules and parsers can&apos;t decide.</EmptyState></Card>
      ) : (
        <div className="grid gap-3">
          {q.items.map((i) => {
            const fromEmail = (i.from ?? "").match(/<([^>]+)>/)?.[1] ?? i.from;
            const fromName = (i.from ?? "").includes("<") ? (i.from ?? "").replace(/<[^>]+>/, "").trim() : null;
            return (
              <ReviewItem key={i.id} canClassify={can(s.ctx, "emails.classify")} canRule={can(s.ctx, "rules.write") && can(s.ctx, "emails.classify")}
                e={{
                  id: i.id, from: i.from, subject: i.subject, receivedAt: i.receivedAt.toISOString(), reason: i.reason, body: i.body,
                  domain: senderDomain(fromEmail), freeMail: FREE_MAIL_DOMAINS.has(senderDomain(fromEmail) ?? ""), fromName, fromEmail,
                  hint: (i.hints as { internationalCountry?: string } | null)?.internationalCountry ?? null,
                  parsed: (i.parsedFields as Record<string, string | null> | null) ?? null,
                  suggestion: (i.suggestion as ReviewEmailSuggestion | null) ?? null,
                }} />
            );
          })}
          {q.total > q.items.length ? <p className="text-center text-sm text-muted">Showing the newest {q.items.length} of {q.total}.</p> : null}
        </div>
      )}
    </>
  );
}
type ReviewEmailSuggestion = { classification: string; reason: string; by: string };

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe2, Mail } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatINR, formatPercent, formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getLead } from "@/modules/leads/service";
import { listEmailsForLead } from "@/modules/email/service";
import { listQuotationsForLead } from "@/modules/quotes/service";
import { listAudit } from "@/modules/core/service";
import { listProducts } from "@/modules/catalog/service";
import { can } from "@/modules/core/permissions";
import { STATUS_LABELS } from "@/modules/leads/types";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { EMAIL_CLASS_LABEL, SourceBadge, StatusBadge } from "@/components/status";
import { CallButton, CopyButton, QuoteButton, WhatsAppButton } from "@/components/leads/actions";
import { EditLeadButton, NoteForm, StatusChanger } from "@/components/leads/detail-client";

export const metadata: Metadata = { title: "Lead" };

function actorLabel(a: string) {
  if (a.startsWith("mcp:")) return `Claude (${a.slice(4)})`;
  if (a.startsWith("system:")) return `System (${a.slice(7)})`;
  if (a.startsWith("human:")) return "Team member";
  return a;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await requireSession("leads.read");
  let detail;
  try {
    detail = await getLead(s.ctx, { leadId: id });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { lead, notes, statusChanges } = detail;
  const [emails, quotes, auditRows, products] = await Promise.all([
    listEmailsForLead(s.ctx, { leadId: id }), listQuotationsForLead(s.ctx, { leadId: id }), listAudit(s.ctx, { entityType: "lead", entityId: id, limit: 50 }), listProducts(s.ctx, {}),
  ]);
  const product = products.find((p) => p.id === lead.productId);
  const canWrite = can(s.ctx, "leads.update_status");
  const where = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");
  const timeline = [
    ...statusChanges.map((c) => ({ at: c.createdAt, kind: "status" as const, text: `${c.fromStatus ? STATUS_LABELS[c.fromStatus] + " → " : ""}${STATUS_LABELS[c.toStatus]}${c.reason ? ` — ${c.reason}` : ""}`, by: c.createdBy })),
    ...notes.map((n) => ({ at: n.createdAt, kind: "note" as const, text: n.body, by: n.createdBy })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" />Leads</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={lead.status} />
            <SourceBadge source={lead.source} channel={lead.channel} />
            {lead.isInternational ? <Badge tone="warning"><Globe2 className="size-3" />International</Badge> : null}
          </div>
          <h1 className="mt-2 break-words text-xl font-semibold sm:text-2xl">{lead.productText ?? "Product not stated"}{lead.quantityText ? <span className="font-normal text-muted"> · {lead.quantityText}</span> : null}</h1>
          <p className="text-sm text-muted" title={formatDateTime(lead.receivedAt)}>Received {formatDateTime(lead.receivedAt)} ({formatRelative(lead.receivedAt)}) · ref {lead.sourceRef.startsWith("gmail:") ? "email" : lead.sourceRef}</p>
        </div>
        {can(s.ctx, "leads.edit") ? (
          <EditLeadButton leadId={lead.id} products={products.map((p) => ({ id: p.id, name: p.name }))}
            lead={{ contactName: lead.contactName, companyName: lead.companyName, phone: lead.phone, email: lead.email, city: lead.city, state: lead.state, country: lead.country, productText: lead.productText, quantityText: lead.quantityText, productId: lead.productId, isInternational: lead.isInternational }} />
        ) : null}
      </div>

      {lead.isInternational ? <Alert tone="warning" className="mb-4" title="International inquiry — quotation drafts are disabled">It stays here (never deleted) until USD pricing is supported.</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Buyer</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">Name</dt><dd className="min-w-0 break-words">{lead.contactName ?? "—"}</dd>
                <dt className="text-muted">Company</dt><dd className="min-w-0 break-words">{lead.companyName ?? "—"}</dd>
                <dt className="text-muted">Phone</dt><dd className="tabular-nums">{lead.phone ? formatPhone(lead.phone) : "—"}</dd>
                <dt className="text-muted">Email</dt><dd className="min-w-0 break-all">{lead.email ?? "—"}</dd>
                <dt className="text-muted">Location</dt><dd>{where || "—"}</dd>
                <dt className="text-muted">Product</dt><dd>{product ? <Link className="text-primary underline-offset-4 hover:underline" href={`/rates?q=${encodeURIComponent(product.name)}`}>{product.name}</Link> : <span className="text-muted">Not matched to catalog — use Edit</span>}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                {lead.phone ? <><WhatsAppButton leadId={lead.id} phone={lead.phone} /><CallButton phone={lead.phone} /><CopyButton value={formatPhone(lead.phone)} label="phone" /></> : null}
                {lead.email ? <CopyButton value={lead.email} label="email" icon="email" /> : null}
                {can(s.ctx, "quotes.create") ? <QuoteButton leadId={lead.id} disabled={lead.isInternational} reason="Quotes are disabled for international leads." /> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Original message</CardTitle><span className="text-xs text-muted">from {lead.channel?.replace("_", " ")}</span></CardHeader>
            <CardContent>
              {lead.message ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{lead.message}</pre> : <p className="text-sm text-muted">No message text.</p>}
              {lead.alternateRefs.length ? <p className="mt-2 text-xs text-muted">Also received via: {lead.alternateRefs.map((r) => `${r.source.replace("_", " ")} (${r.method.replace(/_/g, " ")})`).join(", ")}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Email thread</CardTitle><Mail className="size-4 text-muted" aria-hidden /></CardHeader>
            <CardContent>
              {emails.length === 0 ? <p className="text-sm text-muted">No linked emails. Leads from the TradeIndia API or entered manually have no thread; quotes are drafted as a new email.</p> : (
                <ol className="grid gap-2">
                  {emails.map((e) => (
                    <li key={e.id}>
                      <details className="rounded-md border border-border">
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className="font-medium">{e.isOutgoing ? "You" : e.fromName ?? e.fromEmail}</span>
                          <Badge tone={EMAIL_CLASS_LABEL[e.classification]?.tone}>{EMAIL_CLASS_LABEL[e.classification]?.label}</Badge>
                          <span className="min-w-0 flex-1 truncate text-muted">{e.subject}</span>
                          <span className="text-xs text-muted">{formatDateTime(e.receivedAt)}</span>
                        </summary>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-sans text-sm">{e.bodyText ?? e.snippet}</pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Quotations</CardTitle></CardHeader>
            <CardContent>
              {quotes.length === 0 ? <p className="text-sm text-muted">No quotations yet. &ldquo;Create quote draft&rdquo; renders today&apos;s rate into a Gmail draft in this thread.</p> : (
                <ul className="grid gap-3">
                  {quotes.map((q) => (
                    <li key={q.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={q.status === "draft_created" ? "success" : q.status === "draft_failed" ? "danger" : "neutral"}>{q.status === "draft_created" ? "Draft in Gmail" : q.status === "draft_failed" ? "Draft failed" : "Rendered"}</Badge>
                        <span className="text-muted">{formatDateTime(q.createdAt)} · valid until {formatDate(q.validityDate)}</span>
                        {q.gmailDraftUrl ? <Button asChild size="sm" variant="soft" className="ml-auto"><a href={q.gmailDraftUrl} target="_blank" rel="noopener noreferrer">Open in Gmail <ExternalLink /></a></Button> : null}
                      </div>
                      <ul className="mt-2 grid gap-1">
                        {q.items.map((i) => (
                          <li key={i.priceEntryId}>{i.productName}{i.gradeName !== "Standard" ? ` (${i.gradeName})` : ""}: <strong>{formatINR(i.pricePerKgInr)}/kg</strong> + GST {formatPercent(i.gstPercent)}% · {i.priceBasis}{i.moqKg ? ` · MOQ ${formatPercent(i.moqKg)} kg` : ""}</li>
                        ))}
                      </ul>
                      {q.error ? <p className="mt-1 text-danger">{q.error}</p> : null}
                      <details className="mt-2"><summary className="cursor-pointer text-muted">Quoted text</summary><pre className="mt-1 whitespace-pre-wrap break-words font-sans">{q.bodyText}</pre>
                        <div className="mt-2"><CopyButton value={q.bodyText} label="quotation text" /></div></details>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent><StatusChanger leadId={lead.id} status={lead.status} disabled={!canWrite} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Notes & timeline</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {can(s.ctx, "notes.write") ? <NoteForm leadId={lead.id} /> : null}
              <ol className="grid gap-3 border-l border-border pl-3">
                {timeline.map((t, i) => (
                  <li key={i} className="text-sm">
                    <p className="text-xs text-muted">{formatDateTime(t.at)} · {actorLabel(t.by)}</p>
                    <p className={t.kind === "note" ? "whitespace-pre-wrap break-words" : "font-medium"}>{t.kind === "status" ? `Status: ${t.text}` : t.text}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-1.5 text-xs">
                {auditRows.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2"><span className="text-muted">{formatDateTime(a.createdAt)}</span><span className="font-medium">{a.action}</span><span className="text-muted">{actorLabel(a.actor)}</span></li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

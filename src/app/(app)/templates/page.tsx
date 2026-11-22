import Link from "next/link";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { listTemplates, SAMPLE_VARS } from "@/modules/templates/service";
import { DEFAULT_TEMPLATES, TEMPLATE_PURPOSES, TEMPLATE_PURPOSE_LABELS, WHATSAPP_PURPOSES, type TemplatePurpose } from "@/modules/templates/engine";
import { can } from "@/modules/core/permissions";
import { PageHeader } from "@/components/ui/primitives";
import { TemplateEditor } from "@/components/templates/editor";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Templates" };

/** Templates per purpose and channel (GOAL G-TPL-1); each save is a new version (G-TPL-3). */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ purpose?: string }> }) {
  const s = await requireSession("templates.read");
  const sp = await searchParams;
  const purpose: TemplatePurpose = TEMPLATE_PURPOSES.includes(sp.purpose as TemplatePurpose) ? (sp.purpose as TemplatePurpose) : "first_quotation";
  const all = await listTemplates(s.ctx, {});
  const pick = (k: "quote_email" | "whatsapp") => {
    const rows = all.filter((t) => t.kind === k && t.purpose === purpose);
    return rows.find((t) => t.isDefault) ?? rows[0];
  };
  const fallback = (k: "quote_email" | "whatsapp") => DEFAULT_TEMPLATES.find((d) => d.kind === k && d.purpose === purpose);
  const kinds = (["quote_email", "whatsapp"] as const).filter((k) => k === "quote_email" || WHATSAPP_PURPOSES.includes(purpose));
  const editable = can(s.ctx, "templates.write");
  return (
    <>
      <PageHeader title="Templates" description="One text per kind of message. Placeholders like {{price_per_kg}} are filled with the lead's details, today's rate and your settings. Every save is kept as a new version." />
      <nav aria-label="Kinds of message" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 text-sm">
        {TEMPLATE_PURPOSES.map((p) => (
          <Link key={p} href={`/templates?purpose=${p}`} aria-current={p === purpose ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-md px-3 py-2 font-medium text-muted", p === purpose && "bg-surface text-foreground shadow-card")}>
            {TEMPLATE_PURPOSE_LABELS[p]}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6">
        {kinds.map((k) => {
          const t = pick(k);
          const d = fallback(k);
          return (
            <TemplateEditor key={`${k}-${purpose}-${t?.id ?? "new"}-${t?.version ?? 0}`} id={t?.id} kind={k} purpose={purpose} version={t?.version ?? null}
              name={t?.name ?? "Default"} subject={k === "quote_email" ? t?.subject ?? d?.subject ?? null : null} body={t?.body ?? d?.body ?? ""} sample={SAMPLE_VARS} canEdit={editable} />
          );
        })}
      </div>
    </>
  );
}

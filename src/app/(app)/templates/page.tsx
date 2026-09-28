import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { listTemplates, SAMPLE_VARS } from "@/modules/templates/service";
import { DEFAULT_QUOTE_BODY, DEFAULT_QUOTE_SUBJECT, DEFAULT_WHATSAPP_BODY } from "@/modules/templates/engine";
import { can } from "@/modules/core/permissions";
import { PageHeader } from "@/components/ui/primitives";
import { TemplateEditor } from "@/components/templates/editor";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const s = await requireSession("templates.read");
  const all = await listTemplates(s.ctx, {});
  const pick = (k: "quote_email" | "whatsapp") => all.find((t) => t.kind === k && t.isDefault) ?? all.find((t) => t.kind === k);
  const q = pick("quote_email");
  const w = pick("whatsapp");
  const editable = can(s.ctx, "templates.write");
  return (
    <>
      <PageHeader title="Templates" description="Placeholders like {{price_per_kg}} are filled with the lead's details and today's rate. Wording follows your existing reply style." />
      <div className="grid gap-6">
        <TemplateEditor id={q?.id} kind="quote_email" name={q?.name ?? "Default"} subject={q?.subject ?? DEFAULT_QUOTE_SUBJECT} body={q?.body ?? DEFAULT_QUOTE_BODY} sample={SAMPLE_VARS} canEdit={editable} />
        <TemplateEditor id={w?.id} kind="whatsapp" name={w?.name ?? "Default"} subject={null} body={w?.body ?? DEFAULT_WHATSAPP_BODY} sample={SAMPLE_VARS} canEdit={editable} />
      </div>
    </>
  );
}

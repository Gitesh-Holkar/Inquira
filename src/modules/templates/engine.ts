/**
 * Minimal, safe placeholder renderer: {{name}} only. No logic, no HTML, no code execution,
 * so templates edited in the UI can never run anything.
 */
export const PLACEHOLDERS = {
  contact_name: "Buyer's name (falls back to Sir/Madam)",
  company_name: "Buyer's company",
  product: "Product name",
  grade: "Grade",
  price_per_kg: "Price per kg, e.g. 350.00",
  price_basis: "Price basis, e.g. Ex-factory",
  gst_percent: "GST %, e.g. 18",
  moq: "Minimum order quantity (kg)",
  pack_size: "Pack size, e.g. 20 Kg",
  validity_date: "Quote valid until, e.g. 2 Oct 2026",
  quantity: "Quantity the buyer asked for",
  city: "Buyer's city",
  items_block: "One bullet block per quoted product/grade (multi-product quotes)",
  org_name: "Your organisation name",
} as const;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;
export type TemplateVars = Partial<Record<PlaceholderKey, string>>;

const RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function render(template: string, vars: TemplateVars): string {
  return template.replace(RE, (_m, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? "";
  })
    // Tidy lines left empty by missing optional values like "- MOQ:  kg".
    .replace(/^[ \t]*[-•][^\n:]*:\s*(kg)?[ \t]*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function unknownPlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(RE)) if (!(m[1]! in PLACEHOLDERS)) out.add(m[1]!);
  return [...out];
}

/**
 * Defaults based on STDM's observed reply style (docs/EMAIL_FORMATS.md). Deliberately no sign-off:
 * the real Gmail signature is appended when the draft is created.
 */
export const DEFAULT_QUOTE_SUBJECT = "Quotation – {{product}}";
export const DEFAULT_QUOTE_BODY = `Dear {{contact_name}},

Thank you for your inquiry. Please find below the commercial details for {{product}}:

{{items_block}}

This quotation is valid until {{validity_date}}.

Please let us know if you have any questions or would like to place an order.`;

export const DEFAULT_ITEM_BLOCK = `{{product}} ({{grade}})
- Price: Rs. {{price_per_kg}}/kg ({{price_basis}})
- Pack Size: {{pack_size}}
- GST: {{gst_percent}}% extra
- MOQ: {{moq}} kg`;

export const DEFAULT_WHATSAPP_BODY = `Hello {{contact_name}}, thank you for your inquiry for {{product}}{{quantity}}. Our current rate is Rs. {{price_per_kg}}/kg ({{price_basis}}), GST {{gst_percent}}% extra. Valid until {{validity_date}}. Shall I share the COA and specification?`;

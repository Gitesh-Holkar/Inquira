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
  payment_terms: "Payment terms (the product's, else Settings → Organisation), e.g. 100% advance",
  hsn_code: "HSN code of the product",
  lead_time: "Lead time of the product, e.g. 7 to 10 days",
  validity_date: "Quote valid until, e.g. 2 Oct 2026",
  quantity: "Quantity the buyer asked for",
  city: "Buyer's city",
  items_block: "One bullet block per quoted product/grade (multi-product quotes)",
  org_name: "Your organisation name",
  documents: "Documents attached, e.g. COA and TDS",
  sample_size: "Free sample size from the sample policy, e.g. 250 g",
  sample_details: "Details the buyer must send for a sample, one per line",
  sample_note: "Sample policy note, e.g. who pays for the courier",
  quote_date: "Date the quotation was sent (follow-ups)",
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
    // The whole line goes, with its line break, so no blank line is left in a list.
    .replace(/^[ \t]*[-•][^\n:]*:[ \t]*(kg)?[ \t]*(?:\r?\n|$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function unknownPlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(RE)) if (!(m[1]! in PLACEHOLDERS)) out.add(m[1]!);
  return [...out];
}

/**
 * Defaults based on the first company's observed reply style (docs/EMAIL_FORMATS.md). Deliberately no sign-off:
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
- MOQ: {{moq}} kg
- HSN: {{hsn_code}}
- Lead time: {{lead_time}}
- Payment: {{payment_terms}}`;

export const DEFAULT_WHATSAPP_BODY = `Hello {{contact_name}}, thank you for your inquiry for {{product}}{{quantity}}. Our current rate is Rs. {{price_per_kg}}/kg ({{price_basis}}), GST {{gst_percent}}% extra. Valid until {{validity_date}}. Shall I share the COA and specification?`;

/** What a template is for (GOAL G-TPL-1). */
export const TEMPLATE_PURPOSES = ["first_quotation", "detailed_quotation", "document_share", "sample_request", "below_moq", "follow_up", "international_ack"] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];
export const TEMPLATE_PURPOSE_LABELS: Record<TemplatePurpose, string> = {
  first_quotation: "First quotation",
  detailed_quotation: "Detailed quotation",
  document_share: "Documents",
  sample_request: "Sample reply",
  below_moq: "Below-MOQ reply",
  follow_up: "Follow-up",
  international_ack: "International acknowledgement",
};
/** WhatsApp has no detailed quotation: long lists belong in email. */
export const WHATSAPP_PURPOSES: TemplatePurpose[] = ["first_quotation", "document_share", "sample_request", "below_moq", "follow_up", "international_ack"];

/**
 * Starting texts for every purpose and channel. Generic wording only: no company, product, price or policy;
 * those come from placeholders. No sign-off: the Gmail signature is added when the email is built.
 */
export const DEFAULT_TEMPLATES: { kind: "quote_email" | "whatsapp"; purpose: TemplatePurpose; subject: string | null; body: string }[] = [
  { kind: "quote_email", purpose: "first_quotation", subject: DEFAULT_QUOTE_SUBJECT, body: DEFAULT_QUOTE_BODY },
  { kind: "whatsapp", purpose: "first_quotation", subject: null, body: DEFAULT_WHATSAPP_BODY },
  {
    kind: "quote_email", purpose: "detailed_quotation", subject: "Detailed quotation – {{product}}",
    body: `Dear {{contact_name}},

Thank you for your interest in {{product}}. Please find our detailed offer below:

{{items_block}}

This quotation is valid until {{validity_date}}.

Please let us know the quantity and delivery location you need.`,
  },
  {
    kind: "quote_email", purpose: "document_share", subject: "{{documents}} – {{product}}",
    body: `Dear {{contact_name}},

As requested, please find attached the {{documents}} for {{product}}.

Please let us know if you need anything else.`,
  },
  { kind: "whatsapp", purpose: "document_share", subject: null, body: "Hello {{contact_name}}, we have the {{documents}} for {{product}}. Please share your email address and we will send them right away." },
  {
    kind: "quote_email", purpose: "sample_request", subject: "Sample of {{product}}",
    body: `Dear {{contact_name}},

Thank you for your interest in a sample of {{product}}. We offer a free sample of {{sample_size}}.

To send it, please share:
{{sample_details}}

{{sample_note}}`,
  },
  { kind: "whatsapp", purpose: "sample_request", subject: null, body: "Hello {{contact_name}}, thank you for your interest in a sample of {{product}}. We offer a free sample of {{sample_size}}. Please share: {{sample_details}}. {{sample_note}}" },
  {
    kind: "quote_email", purpose: "below_moq", subject: "Your enquiry for {{product}}",
    body: `Dear {{contact_name}},

Thank you for your enquiry for {{product}}{{quantity}}. Our minimum order quantity for this product is {{moq}} kg.

If you can order {{moq}} kg or more, we will be happy to send you our best offer.`,
  },
  { kind: "whatsapp", purpose: "below_moq", subject: null, body: "Hello {{contact_name}}, thank you for your enquiry for {{product}}{{quantity}}. Our minimum order for this product is {{moq}} kg. If you can order {{moq}} kg or more, we will send our best offer." },
  {
    kind: "quote_email", purpose: "follow_up", subject: "Following up – {{product}}",
    body: `Dear {{contact_name}},

We sent you our quotation for {{product}} on {{quote_date}}. Did you have a chance to look at it?

Please let us know if you have any questions.`,
  },
  { kind: "whatsapp", purpose: "follow_up", subject: null, body: "Hello {{contact_name}}, we sent our quotation for {{product}} on {{quote_date}}. Did you have a chance to look at it? Happy to answer any questions." },
  {
    kind: "quote_email", purpose: "international_ack", subject: "Your enquiry for {{product}}",
    body: `Dear {{contact_name}},

Thank you for your enquiry for {{product}}. We have received it and our team will get back to you with an offer shortly.`,
  },
  { kind: "whatsapp", purpose: "international_ack", subject: null, body: "Hello {{contact_name}}, thank you for your enquiry for {{product}}. Our team will get back to you with an offer shortly." },
];


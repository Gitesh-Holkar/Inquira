export type EmailInput = {
  id: string;
  threadId?: string;
  from: string;
  fromName?: string | null;
  to: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  labelIds?: string[];
  date: Date;
};

export type ParsedLeadFields = {
  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  productText?: string | null;
  quantityText?: string | null;
  message?: string | null;
};

export type ParseResult = {
  format: string;
  source: "indiamart" | "tradeindia";
  /** enquiry/buylead/inquiry create leads; reply is a conversation on an existing lead. */
  kind: "enquiry" | "buylead" | "inquiry" | "reply";
  sourceRef: string | null;
  international: boolean;
  confidence: "high" | "medium" | "low";
  fields: ParsedLeadFields;
  extras?: Record<string, string>;
};

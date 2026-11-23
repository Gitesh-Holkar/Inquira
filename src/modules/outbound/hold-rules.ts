/**
 * Hold rules (GOAL G-OUT-2): code, not AI, decides whether a prepared message may go without a person.
 * A message is held when ANY rule below is true; the reasons are shown on the message. Pure functions,
 * fed by `service.ts` with what it read from the database. RULE_SET_VERSION is recorded on every message.
 */
import type { HoldReason } from "./schema";
import type { Channel, MessagePurpose } from "./types";

export const RULE_SET_VERSION = "hold-rules-2026-11-22";

export type HoldContext = {
  purpose: MessagePurpose;
  channel: Channel;
  /** Text the buyer wrote (lead message and, for a reply, their latest email). */
  buyerText: string;
  productMatched: boolean;
  quantityKg: number | null;
  belowMoq: boolean | null;
  international: boolean;
  /** Quoted rates: none current, past their last day, or flagged "confirm". */
  rateProblem: "missing" | "flagged" | null;
  /** Placeholders the template uses that came out empty. */
  blankTerms: string[];
  /** The rendered message, to see whether it answers what the buyer asked. */
  body: string;
  /** The buyer already wrote back in this conversation (not the first enquiry). */
  inConversation: boolean;
  existingCustomer: boolean;
  /** The buyer's email had attachments. */
  buyerAttachment: boolean;
  /** This buyer already got this purpose for this product recently. */
  alreadySent: boolean;
  /** Documents asked for but no valid file exists (document replies). */
  missingDocuments: string[];
  /** Sample replies: the product's sample flag and whether the policy has a size. */
  sample?: { offered: boolean | null; policySet: boolean };
  /** Written by AI or Claude rather than a template (G-CNV-3: always held). */
  aiWritten: boolean;
  /** Notes of the team's own rules that match (G-OUT-9). */
  customRules: string[];
};

/** Purposes that quote a price: product, quantity and rate must be right. */
const QUOTES = new Set<MessagePurpose>(["first_quotation", "detailed_quotation"]);
/** Purposes that open a conversation; inside an ongoing one a person replies. */
const OPENERS = new Set<MessagePurpose>(["first_quotation", "detailed_quotation", "sample_request", "below_moq"]);

/** Buyer wording a template cannot handle (G-OUT-2: negotiation, credit, complaint, purchase order). */
const RISKY: [RegExp, string][] = [
  [/\b(negotiat\w*|discount|reduce (?:the |your )?(?:price|rate)|lower (?:the |your )?(?:price|rate)|last (?:price|rate)|final (?:price|rate)|too (?:high|costly|expensive))\b/i, "price negotiation"],
  [/\b(credit|on credit|payment after|days? payment|pdc|post[- ]dated)\b/i, "credit"],
  [/\b(complain\w*|damaged|defective|refund|wrong (?:material|product|item|goods)|quality (?:issue|problem))\b/i, "a complaint"],
  [/\b(purchase order|p\.?\s?o\.?\s*(?:no|number|#|copy|attached))\b/i, "a purchase order"],
];

/**
 * Topics a buyer may ask about, and words that show a message answers them. If the buyer asks and the
 * message does not mention it, a person should reply (G-OUT-2 "asked something the template does not answer").
 */
const TOPICS: { topic: string; asked: RegExp; answered: RegExp }[] = [
  { topic: "delivery or freight", asked: /\b(deliver\w*|freight|shipping|transport\w*|courier|door ?step|dispatch)\b/i, answered: /\b(deliver\w*|freight|shipping|transport\w*|courier|dispatch|lead time|ex-?factory|ex-?works)\b/i },
  { topic: "lead time", asked: /\b(lead time|how (?:soon|many days)|when can you (?:send|deliver|dispatch)|urgent\w*)\b/i, answered: /\blead time\b/i },
  { topic: "documents or specifications", asked: /\b(coa|tds|msds|sds|spec(?:ification)?s?|certificate\w*|lab (?:test )?report|fssai|halal|kosher|organic)\b/i, answered: /\b(coa|tds|msds|sds|spec(?:ification)?s?|certificate\w*|attached)\b/i },
  { topic: "a sample", asked: /\bsamples?\b/i, answered: /\bsamples?\b/i },
  { topic: "export or other currencies", asked: /\b(export|usd|\$|dollars?|fob|cif|cnf)\b/i, answered: /\b(export|usd|fob|cif)\b/i },
  { topic: "custom packing or private label", asked: /\b(private label|custom (?:pack\w*|label\w*)|own brand|our brand|white label)\b/i, answered: /\b(private label|custom pack\w*)\b/i },
];

export function unansweredTopics(buyerText: string, body: string): string[] {
  return TOPICS.filter((t) => t.asked.test(buyerText) && !t.answered.test(body)).map((t) => t.topic);
}

export function riskyMentions(buyerText: string): string[] {
  return RISKY.filter(([re]) => re.test(buyerText)).map(([, what]) => what);
}

/** Every rule that holds this message, in a fixed order. Empty = the message may go if the mode allows. */
export function holdReasons(c: HoldContext): HoldReason[] {
  const out: HoldReason[] = [];
  const add = (rule: string, detail: string) => out.push({ rule, detail });
  const quotes = QUOTES.has(c.purpose);

  if (c.aiWritten) add("ai_written", "Written by AI or Claude: a person checks every word before it goes");
  if ((quotes || c.purpose === "document_share" || c.purpose === "sample_request" || c.purpose === "below_moq") && !c.productMatched) {
    add("product_unsure", "The product is not matched to the catalogue");
  }
  if (quotes) {
    if (c.quantityKg === null) add("quantity_missing", "No quantity in kg");
    else if (c.belowMoq) add("below_moq", "The quantity is below the MOQ");
  }
  if (c.purpose === "below_moq" && c.belowMoq) add("below_moq", "The quantity is below the MOQ: a person decides what to offer");
  if (c.international) add("international", "The buyer is outside India");
  if (quotes && c.rateProblem === "missing") add("rate_missing", "No current rate (none entered, or past its valid-until date)");
  if (quotes && c.rateProblem === "flagged") add("rate_flagged", "The rate is marked “confirm”");
  if (c.blankTerms.length) add("terms_blank", `Empty: ${c.blankTerms.join(", ")}`);
  const topics = unansweredTopics(c.buyerText, c.body);
  if (topics.length) add("unanswered", `The buyer asked about ${topics.join(" and ")}, which this message does not answer`);
  if (OPENERS.has(c.purpose) && c.inConversation) add("in_conversation", "The buyer has already written back: this is a conversation");
  if (c.existingCustomer) add("existing_customer", "This buyer is an existing customer");
  const risky = riskyMentions(c.buyerText);
  if (risky.length) add("risky_text", `The buyer mentions ${risky.join(", ")}`);
  if (c.buyerAttachment) add("attachment", "The buyer sent an attachment");
  if (c.alreadySent) add("already_sent", "This buyer already received this message for this product recently");
  if (c.purpose === "document_share" && c.missingDocuments.length) add("documents_missing", `No valid ${c.missingDocuments.join(", ")} for this product`);
  if (c.purpose === "sample_request" && c.sample) {
    if (c.sample.offered === null) add("sample_undecided", "Whether this product has free samples is not set");
    else if (!c.sample.offered) add("sample_not_offered", "This product has no free samples");
    if (!c.sample.policySet) add("sample_policy", "The sample policy (free sample size) is not filled in");
  }
  for (const note of c.customRules) add("team_rule", note);
  return out;
}

export type TeamRule = { matchType: string; pattern: string; note: string | null };

/** The team's own rules (G-OUT-9) that match this buyer, product or text. */
export function matchingTeamRules(rules: TeamRule[], m: { email: string | null; phone: string | null; productId: string | null; text: string }): string[] {
  const out: string[] = [];
  for (const r of rules) {
    const p = r.pattern.trim().toLowerCase();
    if (!p) continue;
    const email = (m.email ?? "").toLowerCase();
    const hit =
      r.matchType === "buyer_email" ? email === p
      : r.matchType === "buyer_domain" ? email.endsWith(`@${p.replace(/^@/, "")}`)
      : r.matchType === "buyer_phone" ? !!m.phone && m.phone.replace(/\D/g, "").endsWith(p.replace(/\D/g, "").slice(-10))
      : r.matchType === "product" ? m.productId === r.pattern
      : r.matchType === "text_contains" ? m.text.toLowerCase().includes(p)
      : false;
    // A product rule's pattern is the product's id: say "this product" rather than show the id.
    if (hit) out.push(`Team rule: ${r.note || (r.matchType === "product" ? "this product is always held" : `${r.matchType.replace("_", " ")} “${r.pattern}”`)}`);
  }
  return out;
}

/** IST clock parts for the send window (G-OUT-4). */
export function istParts(d: Date): { day: number; minutes: number } {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return { day: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export function insideWindow(d: Date, w: { start: string; end: string; days: number[] }): boolean {
  const { day, minutes } = istParts(d);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return w.days.includes(day) && minutes >= toMin(w.start) && minutes < toMin(w.end);
}

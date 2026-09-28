import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toE164 } from "@/lib/phone";
import { classifyEmail } from "./classify";
import { extractRfiId } from "./parsers/tradeindia";
import { parseInlineKv, splitBuyleadIdentity } from "./parsers/indiamart";
import { htmlToText, parseIndianLocation } from "./parsers/text";
import type { EmailInput } from "./parsers/types";

type Fixture = {
  id: string; from: string; to: string[]; subject: string; date: string; text: string | null; html: string | null;
  headers?: Record<string, string>; labels?: string[];
  expected: Record<string, unknown>;
};

const dir = path.join(process.cwd(), "fixtures/emails");
const fixtures: Fixture[] = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
const toInput = (f: Fixture): EmailInput => ({ id: f.id, from: f.from, to: f.to, subject: f.subject, text: f.text, html: f.html, headers: f.headers, labelIds: f.labels, date: new Date(f.date) });
const ctx = { ownAddresses: ["sales@seller.example"], rules: [], threadHasLead: false };

describe("email fixtures (anonymised, from docs/EMAIL_FORMATS.md)", () => {
  it("covers every format", () => expect(fixtures.length).toBeGreaterThanOrEqual(17));

  for (const f of fixtures) {
    it(`${f.id}`, () => {
      const r = classifyEmail(toInput(f), ctx);
      const exp = f.expected;
      const wantClass = exp.classification === "conversation_candidate" ? "conversation" : exp.classification;
      expect(r.classification).toBe(wantClass);
      if (exp.reason) expect(r.reason.toLowerCase()).toContain(String(exp.reason).replace("_", " ").split(" ")[0]);
      if (!r.parsed) return;
      const fields = r.parsed.fields;
      if ("source" in exp && exp.source !== "gmail") expect(r.parsed.source).toBe(exp.source);
      if ("kind" in exp && exp.kind !== "direct") expect(r.parsed.kind).toBe(exp.kind);
      if ("source_ref" in exp) expect(r.parsed.sourceRef).toBe(exp.source_ref);
      if ("contact_name" in exp) expect(fields.contactName).toBe(exp.contact_name);
      if ("company" in exp) expect(fields.companyName ?? null).toBe(exp.company);
      if ("phone" in exp) expect(toE164(fields.phone)).toBe(exp.phone);
      if ("email" in exp) expect(fields.email ?? null).toBe(exp.email);
      if ("city" in exp) expect(fields.city).toBe(exp.city);
      if ("state" in exp) expect(fields.state).toBe(exp.state);
      if ("country" in exp) expect(fields.country === "India" && exp.country === "IN" ? "IN" : fields.country).toBe(exp.country);
      if ("product" in exp) expect(fields.productText ?? null).toBe(exp.product);
      if ("quantity" in exp) expect(fields.quantityText).toBe(exp.quantity);
      if ("international" in exp) expect(r.parsed.international).toBe(exp.international);
      if ("message_contains" in exp) expect(fields.message).toContain(exp.message_contains);
    });
  }

  it("flags a foreign country in direct mail as an international hint (never auto-drops)", () => {
    const f = fixtures.find((x) => x.id === "direct-inquiry-international")!;
    const r = classifyEmail(toInput(f), ctx);
    expect(r.classification).toBe("needs_review");
    expect(r.hints?.internationalCountry).toBe("Indonesia");
  });

  it("treats a reply in a lead's thread as conversation", () => {
    const f = fixtures.find((x) => x.id === "direct-inquiry-domestic")!;
    expect(classifyEmail(toInput(f), { ...ctx, threadHasLead: true }).classification).toBe("conversation");
  });

  it("applies user rules before heuristics (corrections become rules)", () => {
    const f = fixtures.find((x) => x.id === "vendor-pitch")!;
    const r = classifyEmail(toInput(f), { ...ctx, rules: [{ id: "r1", matchType: "sender_domain", pattern: "packaging.example", action: "ignore", priority: 10, enabled: true }] });
    expect(r).toMatchObject({ classification: "ignored", by: "rule:r1" });
  });
});

describe("parser helpers", () => {
  it("decodes the TradeIndia rfi_id from the ext= parameter and the tracking pixel", () => {
    const ext = Buffer.from("rfi_id=843281891&amp;section=Inbox#myReply").toString("base64");
    expect(extractRfiId(`http://x/y?id=1&ext=${ext})`)).toBe("843281891");
    const placeholder = Buffer.from("rfi_id=__RFI_ID__&amp;section=Inbox#myReply").toString("base64");
    expect(extractRfiId(`?ext=${placeholder}`)).toBeNull();
    expect(extractRfiId('<img src="https://inquiry.tradeindia.com/utils/email_read.html?key=a&rfi_id=843211240&mailer_id=523">')).toBe("843211240");
  });

  it.each([
    ["Kavya Rao Hilltop Food Products Dimapur - 797112, NL", { name: "Kavya Rao", company: "Hilltop Food Products", city: "Dimapur", state: "Nagaland" }],
    ["BHAGYA OZA , Kalyan, MH", { name: "BHAGYA OZA", company: null, city: "Kalyan", state: "Maharashtra" }],
    ["Ravi Singh Q Aqua Water Plant , Sendhwa, MP", { name: "Ravi Singh", company: "Q Aqua Water Plant", city: "Sendhwa", state: "Madhya Pradesh" }],
    ["S Chennai - 600076, TN", { name: "S", company: null, city: "Chennai", state: "Tamil Nadu" }],
    ["AMIT Naik Sample Flour Mill, Goa, H. No. 96, St. Anthony waddo, Tiswadi, Goa - 403108, GA", { name: "AMIT Naik", company: "Sample Flour Mill", city: "Goa", state: "Goa" }],
    ["Mohan", { name: "Mohan", company: null, city: null, state: null }],
  ])("splitBuyleadIdentity(%s)", (line, want) => expect(splitBuyleadIdentity(line)).toEqual(want));

  it("parses IndiaMART inline key/values with known keys", () => {
    expect(parseInlineKv("Grade : Food Grade Packaging Size : 25 kg Application : Food Industry Quantity : 100 Kg")).toEqual({
      Grade: "Food Grade", "Packaging Size": "25 kg", Application: "Food Industry", Quantity: "100 Kg",
    });
  });

  it("parses Indian locations", () => {
    expect(parseIndianLocation("Bengaluru, Karnataka, India")).toEqual({ city: "Bengaluru", state: "Karnataka", country: "India" });
    expect(parseIndianLocation("Plot 1, X Nagar, Nabarangpur - 764059, Odisha, India")).toEqual({ city: "Nabarangpur", state: "Odisha", country: "India" });
    expect(parseIndianLocation("Lebanon")).toEqual({ city: null, state: null, country: "Lebanon" });
  });

  it("converts HTML to text with line breaks", () => {
    expect(htmlToText("<p>Hi <b>there</b></p><table><tr><td>A</td><td>:</td><td>1 &amp; 2</td></tr></table>")).toBe("Hi there\nA : 1 & 2");
  });
});

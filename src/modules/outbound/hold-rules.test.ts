import { describe, expect, it } from "vitest";
import { holdReasons, insideWindow, matchingTeamRules, unansweredTopics, type HoldContext } from "./hold-rules";

/** A first quotation that passes every rule. */
const ok: HoldContext = {
  purpose: "first_quotation", channel: "email", buyerText: "Kindly send price for 500 kg", productMatched: true, quantityKg: 500, belowMoq: false,
  international: false, rateProblem: null, blankTerms: [], body: "Price: Rs. 300/kg (Ex-factory)", inConversation: false, existingCustomer: false,
  buyerAttachment: false, alreadySent: false, missingDocuments: [], aiWritten: false, customRules: [],
};
const rules = (over: Partial<HoldContext>) => holdReasons({ ...ok, ...over }).map((r) => r.rule);

describe("hold rules (GOAL G-OUT-2): one test per rule", () => {
  it("a clean first quotation passes", () => expect(rules({})).toEqual([]));
  it("product not matched", () => expect(rules({ productMatched: false })).toEqual(["product_unsure"]));
  it("quantity missing", () => expect(rules({ quantityKg: null })).toEqual(["quantity_missing"]));
  it("quantity below MOQ", () => expect(rules({ belowMoq: true })).toEqual(["below_moq"]));
  it("buyer outside India", () => expect(rules({ international: true })).toEqual(["international"]));
  it("rate missing or past its validity", () => expect(rules({ rateProblem: "missing" })).toEqual(["rate_missing"]));
  it("rate flagged", () => expect(rules({ rateProblem: "flagged" })).toEqual(["rate_flagged"]));
  it("required terms blank", () => expect(holdReasons({ ...ok, blankTerms: ["pack size"] })[0]).toMatchObject({ rule: "terms_blank", detail: "Empty: pack size" }));
  it("the buyer asked something the message does not answer", () => {
    expect(rules({ buyerText: "Price for 500 kg delivered to Pune? Also the lead time" })).toEqual(["unanswered"]);
    expect(rules({ buyerText: "Price delivered to Pune", body: "Ex-factory price, freight extra" })).toEqual([]);
    expect(unansweredTopics("Please send COA", "Please find the COA attached")).toEqual([]);
  });
  it("a reply in an existing conversation", () => {
    expect(rules({ inConversation: true })).toEqual(["in_conversation"]);
    expect(rules({ purpose: "document_share", inConversation: true })).toEqual([]); // document replies belong in conversations
  });
  it("an existing customer", () => expect(rules({ existingCustomer: true })).toEqual(["existing_customer"]));
  it("negotiation, credit, complaint or purchase order in the text", () => {
    for (const t of ["Can you reduce the price?", "We need 30 days credit", "Last lot was damaged", "PO no 4411 attached"]) expect(rules({ buyerText: t }), t).toEqual(["risky_text"]);
  });
  it("the buyer sent an attachment", () => expect(rules({ buyerAttachment: true })).toEqual(["attachment"]));
  it("the same buyer already received this", () => expect(rules({ alreadySent: true })).toEqual(["already_sent"]));
  it("documents missing", () => expect(rules({ purpose: "document_share", missingDocuments: ["COA"] })).toEqual(["documents_missing"]));
  it("sample policy and product sample flag", () => {
    expect(rules({ purpose: "sample_request", buyerText: "Need a sample", body: "free sample", sample: { offered: null, policySet: false } })).toEqual(["sample_undecided", "sample_policy"]);
    expect(rules({ purpose: "sample_request", buyerText: "Need a sample", body: "free sample", sample: { offered: false, policySet: true } })).toEqual(["sample_not_offered"]);
    expect(rules({ purpose: "sample_request", buyerText: "Need a sample", body: "free sample", sample: { offered: true, policySet: true } })).toEqual([]);
  });
  it("written by AI or Claude", () => expect(rules({ purpose: "reply", aiWritten: true })).toEqual(["ai_written"]));
  it("the team's own rules (corrections)", () => {
    const team = matchingTeamRules([{ matchType: "buyer_domain", pattern: "example.org", note: "Always a person for this buyer" }], { email: "x@example.org", phone: null, productId: null, text: "" });
    expect(holdReasons({ ...ok, customRules: team })).toEqual([{ rule: "team_rule", detail: "Team rule: Always a person for this buyer" }]);
    expect(matchingTeamRules([{ matchType: "buyer_phone", pattern: "9000000101", note: null }], { email: null, phone: "+919000000101", productId: null, text: "" })).toHaveLength(1);
    expect(matchingTeamRules([{ matchType: "text_contains", pattern: "tender", note: null }], { email: null, phone: null, productId: null, text: "Govt TENDER" })).toHaveLength(1);
    // A product rule's pattern is an id: the reason must not show it.
    expect(matchingTeamRules([{ matchType: "product", pattern: "0b8e6c1e-0000-4000-8000-000000000001", note: null }], { email: null, phone: null, productId: "0b8e6c1e-0000-4000-8000-000000000001", text: "" }))
      .toEqual(["Team rule: this product is always held"]);
  });
});

describe("send window (G-OUT-4)", () => {
  const w = { start: "09:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] };
  it("is in IST, Monday to Saturday", () => {
    expect(insideWindow(new Date("2026-11-23T10:00:00+05:30"), w)).toBe(true); // Monday
    expect(insideWindow(new Date("2026-11-23T19:00:00+05:30"), w)).toBe(false);
    expect(insideWindow(new Date("2026-11-23T08:59:00+05:30"), w)).toBe(false);
    expect(insideWindow(new Date("2026-11-22T10:00:00+05:30"), w)).toBe(false); // Sunday
  });
});

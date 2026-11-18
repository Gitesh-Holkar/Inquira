import { describe, expect, it } from "vitest";
import { belowMoq, intentByRules, mentionsWeight, quantityToKg } from "./understanding";

describe("quantity in kg (G-UND-4)", () => {
  it.each([
    ["30 KG", "30"], ["10 MT", "10000"], ["1 Jar", null], ["25 Kg", "25"], ["1 ton", "1000"], ["500 grams", "0.5"], ["1,000 kg", "1000"],
    ["2 quintal", "200"], ["100 Kilogram", "100"], ["4 bags of 25 kg", "100"], ["25 kg x 4", "100"], ["5 drums", null], ["some", null], ["", null],
    ["1.5 tonnes", "1500"], ["2 lbs", "0.907"],
  ])("%s → %s", (text, kg) => expect(quantityToKg(text)).toBe(kg));

  it("knows when a text states a weight at all", () => {
    expect(mentionsWeight("need 500 kg monthly")).toBe(true);
    expect(mentionsWeight("1 Jar")).toBe(false);
    expect(mentionsWeight(null)).toBe(false);
  });

  it("flags below MOQ only when both sides are known", () => {
    expect(belowMoq("30", 100)).toBe(true);
    expect(belowMoq("100", 100)).toBe(false);
    expect(belowMoq(null, 100)).toBeNull();
    expect(belowMoq("30", null)).toBeNull();
  });
});

describe("intent by rules (G-UND-3)", () => {
  it.each([
    ["Please send COA and TDS for your isolate", "document_request"],
    ["Can you send a free sample first?", "sample_request"],
    ["Please find attached PO no 4411 for 200 kg", "order"],
    ["The last lot was damaged in transit, we want a refund", "complaint"],
  ])("%s → %s", (message, intent) => expect(intentByRules({ channel: "direct_email", message })?.intent).toBe(intent));

  it("calls a portal enquiry a new enquiry unless its message says more, and leaves plain email to AI", () => {
    expect(intentByRules({ channel: "indiamart_api_w", message: "Kindly send price" })).toEqual({ intent: "new_enquiry", by: "rule:portal_enquiry" });
    expect(intentByRules({ channel: "manual", message: null })?.intent).toBe("new_enquiry");
    expect(intentByRules({ channel: "direct_email", message: "Hello, please share details" })).toBeNull();
  });
});

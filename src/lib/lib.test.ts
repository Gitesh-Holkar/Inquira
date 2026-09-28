import { describe, expect, it } from "vitest";
import { formatPhone, normalizeEmail, toE164, whatsappUrl } from "./phone";
import { addDays, formatDate, formatDateTime, formatINR, formatRelative, todayIST } from "./format";
import { decryptJson, encryptJson, randomToken, sha256 } from "./crypto";

describe("phone", () => {
  it.each([
    ["+91-9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+961-79159918", "+96179159918"],
    ["", null],
    ["not a phone", null],
  ])("toE164(%s) = %s", (raw, e164) => expect(toE164(raw)).toBe(e164));

  it("formats Indian numbers as +91 98765 43210", () => expect(formatPhone("+919876543210")).toBe("+91 98765 43210"));
  it("builds wa.me links without +", () =>
    expect(whatsappUrl("+919876543210", "Hi there & welcome")).toBe("https://wa.me/919876543210?text=Hi%20there%20%26%20welcome"));
  it("normalises emails", () => {
    expect(normalizeEmail("  John.Doe@Example.COM ")).toBe("john.doe@example.com");
    expect(normalizeEmail("Name <x@y.co>")).toBe("x@y.co");
    expect(normalizeEmail("nope")).toBeNull();
  });
});

describe("format", () => {
  it("uses Indian grouping for rupees", () => {
    expect(formatINR(123456)).toBe("₹1,23,456.00");
    expect(formatINR("350")).toBe("₹350.00");
  });
  it("formats IST date-times", () => {
    expect(formatDateTime("2026-09-29T10:40:00Z")).toBe("29 Sep 2026, 4:10 PM");
    expect(formatDate("2026-10-02")).toBe("2 Oct 2026");
  });
  it("formats relative times", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(formatRelative(new Date("2026-09-29T10:00:00Z"), now)).toBe("2h ago");
    expect(formatRelative(new Date("2026-09-29T11:59:50Z"), now)).toBe("just now");
    expect(formatRelative(new Date("2026-09-26T12:00:00Z"), now)).toBe("3d ago");
  });
  it("computes IST calendar days", () => {
    expect(todayIST(new Date("2026-09-28T20:00:00Z"))).toBe("2026-09-29");
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
  });
});

describe("crypto", () => {
  it("round-trips AES-GCM and rejects tampering", () => {
    const blob = encryptJson({ refreshToken: "secret" });
    expect(blob.startsWith("v1.")).toBe(true);
    expect(decryptJson(blob)).toEqual({ refreshToken: "secret" });
    const parts = blob.split(".");
    const bad = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".");
    expect(() => decryptJson(bad)).toThrow();
  });
  it("makes prefixed random tokens and stable hashes", () => {
    const t = randomToken("inq_mcp");
    expect(t).toMatch(/^inq_mcp_[A-Za-z0-9_-]{43}$/);
    expect(sha256("a")).toHaveLength(64);
  });
});

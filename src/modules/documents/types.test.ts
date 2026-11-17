import { describe, expect, it } from "vitest";
import { fileExtension, looksLike, safeFileName, validity } from "./types";

describe("document helpers (G-KB-4)", () => {
  it("says whether a document is valid, expiring soon or expired on a given IST day", () => {
    expect(validity(null, "2026-11-17")).toEqual({ status: "no_expiry", daysLeft: null });
    expect(validity("2026-11-17", "2026-11-17")).toEqual({ status: "expiring", daysLeft: 0 }); // valid through its expiry day
    expect(validity("2026-11-16", "2026-11-17")).toEqual({ status: "expired", daysLeft: -1 });
    expect(validity("2026-12-17", "2026-11-17")).toEqual({ status: "expiring", daysLeft: 30 });
    expect(validity("2026-12-18", "2026-11-17")).toEqual({ status: "valid", daysLeft: 31 });
  });

  it("recognises real files by their first bytes, not by the name", () => {
    const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));
    expect(looksLike("pdf", bytes("%PDF-1.7 ..."))).toBe(true);
    expect(looksLike("pdf", bytes("<html><script>alert(1)</script>"))).toBe(false);
    expect(looksLike("png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(looksLike("jpg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLike("docx", bytes([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(looksLike("html", bytes("<html>"))).toBe(false);
  });

  it("cleans file names for storage and download headers", () => {
    expect(safeFileName("C:\\\\Users\\\\me\\\\COA \"batch\" 12.pdf")).toBe("COA batch 12.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("\u0000")).toBe("file");
    expect(fileExtension("Report.PDF")).toBe("pdf");
    expect(fileExtension("noext")).toBe("");
  });
});

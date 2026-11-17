/** Document library: types, limits and pure helpers (GOAL G-KB-4). */
export const DOCUMENT_TYPES = ["coa", "tds", "msds", "specification", "brochure", "certificate"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  coa: "COA (certificate of analysis)", tds: "TDS (technical data sheet)", msds: "MSDS (safety data sheet)",
  specification: "Specification", brochure: "Brochure", certificate: "Certificate",
};
export const DOCUMENT_TYPE_SHORT: Record<DocumentType, string> = {
  coa: "COA", tds: "TDS", msds: "MSDS", specification: "Specification", brochure: "Brochure", certificate: "Certificate",
};

/** Largest file accepted. The hosting platform refuses request bodies above 4.5 MB. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
/** Days before expiry when a document shows "expires soon". */
export const EXPIRING_SOON_DAYS = 30;

/** Allowed extensions → the content type the file is stored and served with. */
export const ALLOWED_FILES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  doc: "application/msword", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_FILES).map((e) => `.${e}`).join(",");

export function fileExtension(name: string): string {
  return (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
}

/**
 * Checks the first bytes match the extension, so a web page renamed to ".pdf" is refused.
 * Office files are ZIP (docx, xlsx) or the older compound format (doc, xls).
 */
export function looksLike(ext: string, b: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  switch (ext) {
    case "pdf": return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "png": return starts(0x89, 0x50, 0x4e, 0x47);
    case "jpg": case "jpeg": return starts(0xff, 0xd8, 0xff);
    case "webp": return starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    case "docx": case "xlsx": return starts(0x50, 0x4b, 0x03, 0x04);
    case "doc": case "xls": return starts(0xd0, 0xcf, 0x11, 0xe0);
    default: return false;
  }
}

/** A file name safe for storage, headers and display: no folders, control characters or quotes. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  return (clean || "file").slice(-120);
}

export type Validity = { status: "valid" | "expiring" | "expired" | "no_expiry"; daysLeft: number | null };

/** Whether a document is still valid on `today` (both `YYYY-MM-DD`, IST). */
export function validity(expiryDate: string | null, today: string): Validity {
  if (!expiryDate) return { status: "no_expiry", daysLeft: null };
  const daysLeft = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
  if (daysLeft < 0) return { status: "expired", daysLeft };
  return { status: daysLeft <= EXPIRING_SOON_DAYS ? "expiring" : "valid", daysLeft };
}

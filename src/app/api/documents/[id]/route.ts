/**
 * Downloads one document's file (GOAL G-KB-4). The proxy does not guard /api paths, so this route checks
 * the session itself: signed-out visitors go to the sign-in page, members without `documents.read` get
 * 403, and another company's document is 404. Files are always sent as downloads with the type they
 * were stored with, so nothing uploaded can run as a web page on this site.
 */
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { can } from "@/modules/core/permissions";
import { getDocumentFile } from "@/modules/documents/service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getAppSession();
  if (!s) return NextResponse.redirect(new URL("/login?next=%2Fdocuments", appUrl()), 303);
  if (!can(s.ctx, "documents.read")) return new NextResponse("You don't have access to documents.", { status: 403 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const f = await getDocumentFile(s.ctx, { documentId: id });
    return new NextResponse(Buffer.from(f.data), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        "Content-Length": String(f.data.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return new NextResponse("Not found", { status: 404 });
    if (e instanceof AppError) return new NextResponse(e.message, { status: 502 });
    throw e;
  }
}

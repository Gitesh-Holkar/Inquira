/**
 * Downloads one backup (GOAL G-PLT-7): owners only, because it holds all the company's data. Checks the
 * session itself (the proxy does not guard /api paths); always a download, never shown in the browser.
 */
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getBackupFile } from "@/modules/backup/service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getAppSession();
  if (!s) return NextResponse.redirect(new URL("/login?next=%2Fsettings%3Ftab%3Dbackups", appUrl()), 303);
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const f = await getBackupFile(s.ctx, { backupId: id });
    return new NextResponse(Buffer.from(f.data), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${f.fileName}"`,
        "Content-Length": String(f.data.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return new NextResponse(e.message, { status: 403 });
    if (e instanceof AppError && e.code === "NOT_FOUND") return new NextResponse("Not found", { status: 404 });
    if (e instanceof AppError) return new NextResponse(e.message, { status: 502 });
    throw e;
  }
}

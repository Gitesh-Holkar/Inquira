import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";
import { publicMessage } from "@/lib/errors";
import { completeGmailConnect } from "@/modules/sources/gmail/service";

export const dynamic = "force-dynamic";

/** Google redirects here after consent. The signed-in owner/admin who started the flow completes it. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, url.origin));
  const err = url.searchParams.get("error");
  if (err) return back(`gmail_error=${encodeURIComponent(err === "access_denied" ? "You cancelled the Google consent screen." : err)}`);
  const s = await getAppSession();
  if (!s) return NextResponse.redirect(new URL("/login?next=/settings", url.origin));
  try {
    const r = await completeGmailConnect(s.ctx, { code: url.searchParams.get("code") ?? "", state: url.searchParams.get("state") ?? "" });
    return back(`gmail=connected&account=${encodeURIComponent(r.accountEmail)}`);
  } catch (e) {
    return back(`gmail_error=${encodeURIComponent(publicMessage(e).message)}`);
  }
}

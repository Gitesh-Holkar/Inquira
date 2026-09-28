import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";

/** Exchanges the code in Supabase's email links (invite / password reset) for a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${appUrl()}${safe}`);
  }
  return NextResponse.redirect(`${appUrl()}/login?error=link`);
}

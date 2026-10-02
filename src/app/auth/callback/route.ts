import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["recovery", "invite", "signup", "magiclink", "email", "email_change"];

function safePath(next: string | null): string {
  const n = next ?? "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

/**
 * Landing point for links in Supabase emails (password reset / first sign-in / invite). Handles:
 *  - ?code=…                 PKCE links (default): must be opened in the browser that asked for the email;
 *  - ?token_hash=…&type=…    links from an edited email template (docs/SETUP.md §4): work in any browser;
 *  - ?error=…                Supabase's own error (expired or already-used link).
 * Redirects stay on the origin the link was opened on, so a wrong APP_URL can't send people elsewhere.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safePath(url.searchParams.get("next"));
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  if (url.searchParams.get("error") || url.searchParams.get("error_code")) return fail("link_expired");
  const supabase = await supabaseServer();

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail("link_expired");
    return NextResponse.redirect(new URL(type === "recovery" || type === "invite" || type === "signup" ? "/auth/update-password" : next, url.origin));
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    return fail("other_browser");
  }
  return fail("link_expired");
}

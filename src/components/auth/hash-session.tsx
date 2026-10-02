"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** "#error=access_denied&error_code=otp_expired&…" (an old or already-used email link) → a message. */
function hashError(hash: string): string | null {
  const p = new URLSearchParams(hash.slice(1));
  if (!p.get("error") && !p.get("error_code")) return null;
  if (p.get("error_code") === "otp_expired") return "That email link has expired or was already used. Ask for a new one below.";
  return `That email link didn't work (${p.get("error_description") ?? p.get("error")}). Ask for a new one below.`;
}

/**
 * Handles Supabase links that carry the session in the URL hash (#access_token=…&type=recovery|invite),
 * e.g. "Send password recovery" from the Supabase dashboard, and the #error=… they carry when expired.
 * Code-based links go through /auth/callback.
 */
export function HashSessionHandler() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  // Read on the client only (the server never sees the hash), without a hydration mismatch.
  const linkError = useSyncExternalStore(noSubscribe, () => hashError(window.location.hash), () => null);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!accessToken || !refreshToken || !url || !key) return;
    const supabase = createBrowserClient(url, key);
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      history.replaceState(null, "", window.location.pathname);
      if (error) {
        setMsg("That link has expired. Ask for a new one below.");
        return;
      }
      setMsg("Signed in. Redirecting…");
      const type = hash.get("type");
      router.replace(type === "recovery" || type === "invite" || type === "signup" ? "/auth/update-password" : "/");
    });
  }, [router]);
  const text = msg ?? linkError;
  return text ? (
    <p role="status" className="mb-3 text-sm text-muted">
      {text}
    </p>
  ) : null;
}

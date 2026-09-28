"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Handles Supabase links that carry the session in the URL hash (#access_token=…&type=recovery|invite),
 * e.g. "Send password recovery" from the Supabase dashboard. Code-based links go through /auth/callback.
 */
export function HashSessionHandler() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
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
  return msg ? (
    <p role="status" className="mb-3 text-sm text-muted">
      {msg}
    </p>
  ) : null;
}

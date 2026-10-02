"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { appSessionFor, devUserIdByEmail } from "@/lib/auth";
import { appUrl, isDevAuth } from "@/lib/env";
import { DEV_COOKIE, signDevSession } from "@/lib/dev-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string; email?: string };

const safeNext = (n: FormDataEntryValue | null) => {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

async function ipKey(prefix: string) {
  const h = await headers();
  return `${prefix}:${clientIp(new Request("http://x", { headers: h }))}`;
}

/**
 * The address the person is using right now (e.g. https://inquira-xyz.vercel.app), for links in auth
 * emails. Falls back to APP_URL. Supabase only accepts redirect URLs listed under Authentication → URL
 * Configuration, so a forged Host header can't send links elsewhere.
 */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return appUrl();
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

const NO_PASSWORD_HINT = "Email or password is incorrect. First time here? Click “Forgot password? / First time here?” below to set your password.";

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", email: String(form.get("email") ?? "") };
  if (!rateLimit(await ipKey("login"), { capacity: 10, refillPerMinute: 5 })) return { error: "Too many attempts. Wait a minute and try again.", email: parsed.data.email };
  if (!supabaseConfigured()) return { error: "Supabase is not configured on this server.", email: parsed.data.email };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
      return { error: "This email isn't confirmed yet. Use “Forgot password? / First time here?” to get a link that confirms it.", email: parsed.data.email };
    }
    if (error.status === 429) return { error: "Too many attempts. Wait a minute and try again.", email: parsed.data.email };
    return { error: NO_PASSWORD_HINT, email: parsed.data.email };
  }
  // A correct password is not enough: the account must belong to an organisation in Inquira.
  if (!(await appSessionFor({ id: data.user.id, email: data.user.email ?? parsed.data.email }))) {
    await supabase.auth.signOut();
    return { error: `${parsed.data.email} can sign in but isn't a member of any organisation in Inquira. Use the owner email from setup, or ask the owner to add you.`, email: parsed.data.email };
  }
  redirect(safeNext(form.get("next")));
}

export async function sendReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter the email you sign in with." };
  if (!rateLimit(await ipKey("reset"), { capacity: 3, refillPerMinute: 1 })) return { error: "Please wait a minute before asking again.", email: email.data };
  if (!supabaseConfigured()) return { error: "Supabase is not configured on this server." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${await currentOrigin()}/auth/callback?next=/auth/update-password` });
  // Supabase answers the same way whether or not the account exists, so showing its errors leaks nothing.
  if (error) {
    console.error("resetPasswordForEmail failed:", error.status, error.message);
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      return { error: "Supabase's built-in email service sends only a few emails per hour. Wait an hour and try again, or ask the project owner to send a recovery link from the Supabase dashboard (Authentication → Users).", email: email.data };
    }
    return { error: `The email could not be sent (${error.message}). Check Supabase → Authentication → Emails, or send a recovery link from Authentication → Users.`, email: email.data };
  }
  return { message: "If that email has an account, a link to set your password is on its way. Open it in this browser. It can take a minute; check spam too.", email: email.data };
}

export async function updatePassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const pw = String(form.get("password") ?? "");
  if (pw.length < 10) return { error: "Use at least 10 characters." };
  if (pw !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: "That link has expired. Ask for a new one from the sign-in page." };
  redirect("/");
}

/** Local development only (AUTH_MODE=dev). Refused in production and on Vercel. */
export async function devSignIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isDevAuth()) return { error: "Dev sign-in is disabled." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const id = await devUserIdByEmail(email);
  if (!id) return { error: `No local user ${email}. Run npm run db:seed first.`, email };
  (await cookies()).set(DEV_COOKIE, signDevSession(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  if (isDevAuth()) (await cookies()).delete(DEV_COOKIE);
  else if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  redirect("/login");
}

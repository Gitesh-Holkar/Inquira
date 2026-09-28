"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devUserIdByEmail } from "@/lib/auth";
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

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", email: String(form.get("email") ?? "") };
  if (!rateLimit(await ipKey("login"), { capacity: 10, refillPerMinute: 5 })) return { error: "Too many attempts. Wait a minute and try again.", email: parsed.data.email };
  if (!supabaseConfigured()) return { error: "Supabase is not configured on this server.", email: parsed.data.email };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password is incorrect.", email: parsed.data.email };
  redirect(safeNext(form.get("next")));
}

export async function sendReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter the email you sign in with." };
  if (!rateLimit(await ipKey("reset"), { capacity: 3, refillPerMinute: 1 })) return { error: "Please wait a minute before asking again.", email: email.data };
  if (!supabaseConfigured()) return { error: "Supabase is not configured on this server." };
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl()}/auth/callback?next=/auth/update-password` });
  // Same answer whether or not the account exists.
  return { message: "If that email has an account, a link to set your password is on its way.", email: email.data };
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

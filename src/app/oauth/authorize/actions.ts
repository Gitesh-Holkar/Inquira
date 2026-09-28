"use server";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth";
import { issueAuthorizationCode, OAuthError, validateAuthorizeRequest } from "@/modules/mcp/service";

/** Consent granted: issue a single-use code and send the browser back to Claude. */
export async function approveAction(params: Record<string, string>) {
  const s = await getAppSession();
  if (!s) redirect("/login");
  let target: string;
  try {
    const v = await validateAuthorizeRequest(params);
    target = await issueAuthorizationCode(s.ctx, v.params);
  } catch (e) {
    const msg = e instanceof OAuthError ? e.description : e instanceof Error ? e.message : "Authorization failed";
    redirect(`/oauth/authorize?error=${encodeURIComponent(msg)}`);
  }
  redirect(target);
}

/** Consent denied: RFC 6749 access_denied back to the client. */
export async function denyAction(params: Record<string, string>) {
  const v = await validateAuthorizeRequest(params).catch(() => null);
  if (!v) redirect("/");
  const u = new URL(v.params.redirect_uri);
  u.searchParams.set("error", "access_denied");
  if (v.params.state) u.searchParams.set("state", v.params.state);
  redirect(u.toString());
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getAppSession } from "@/lib/auth";
import { OAuthError, validateAuthorizeRequest } from "@/modules/mcp/service";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { approveAction, denyAction } from "./actions";

export const metadata: Metadata = { title: "Connect Claude" };
export const dynamic = "force-dynamic";

const CAN = [
  "Read leads, emails waiting for review, rates and rules",
  "Classify review emails and create leads from them",
  "Update lead status and add notes",
  "Create quotation drafts in Gmail (a person always clicks Send)",
  "Read and log IndiaMART Buy Lead decisions",
];
const CANNOT = ["Send email", "Delete anything", "Change rates or settings", "Read passwords, API keys or tokens", "Export data in bulk"];

/** OAuth consent screen for MCP clients such as claude.ai custom connectors (ADR-013). */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  if (params.error && !params.client_id) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <Alert tone="danger" title="Connection failed" className="max-w-md">{params.error}</Alert>
      </main>
    );
  }
  const s = await getAppSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params)}`)}`);

  let client: Awaited<ReturnType<typeof validateAuthorizeRequest>>["client"];
  try {
    client = (await validateAuthorizeRequest(params)).client;
  } catch (e) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <Alert tone="danger" title="This connection request is invalid" className="max-w-md">
          {e instanceof OAuthError ? e.description : "Unknown error"}
        </Alert>
      </main>
    );
  }
  const host = new URL(params.redirect_uri!).host;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const allowed = s.role === "owner" || s.role === "admin";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="grid gap-4 py-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-6 text-primary" aria-hidden />
            <h1 className="text-lg font-semibold">Connect {client.clientName ?? "an MCP client"} to Inquira?</h1>
          </div>
          <p className="text-sm">
            It will act for <strong>{s.orgName}</strong>. After approval you&apos;ll return to <strong className="break-all">{host}</strong>.
          </p>
          {loopback ? (
            <Alert tone="warning" title="This returns to a program on your own computer">
              Only continue if you just started this from Claude Code or another tool you trust.
            </Alert>
          ) : null}
          <div className="grid gap-2 text-sm">
            <p className="font-medium">It can:</p>
            <ul className="list-disc pl-5">{CAN.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="font-medium">It cannot:</p>
            <ul className="list-disc pl-5 text-muted">{CANNOT.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          {!allowed ? <Alert tone="danger" title="Only owners and admins can connect Claude." /> : null}
          <div className="flex justify-end gap-2">
            <form action={denyAction.bind(null, params)}>
              <Button variant="outline" type="submit">Deny</Button>
            </form>
            <form action={approveAction.bind(null, params)}>
              <Button type="submit" disabled={!allowed}>Allow</Button>
            </form>
          </div>
          <p className="text-xs text-muted">Every action Claude takes is recorded in the audit log. You can revoke access any time in Settings → Claude / MCP.</p>
        </CardContent>
      </Card>
    </main>
  );
}

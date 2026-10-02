import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { appSessionFor, getSessionUser } from "@/lib/auth";
import { isDevAuth } from "@/lib/env";
import { LoginForm } from "./forms";
import { signOut } from "./actions";
import { HashSessionHandler } from "@/components/auth/hash-session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const LINK_ERRORS: Record<string, string> = {
  link_expired: "That email link has expired or was already used. Ask for a new one below.",
  other_browser: "That email link must be opened in the same browser where you asked for it. Ask for a new one below and open it here.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const user = await getSessionUser();
  if (user && (await appSessionFor(user))) redirect(safeNext);
  const linkError = error ? (LINK_ERRORS[error] ?? LINK_ERRORS.link_expired) : null;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 text-xl font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">In</span>
          Inquira
        </div>
        <Card>
          <CardContent className="py-5">
            <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
            <p className="mb-4 text-sm text-muted">Leads, rates and quotations in one place.</p>
            <HashSessionHandler />
            {user ? (
              // Signed in to Supabase, but no organisation membership: explain instead of looping.
              <div className="grid gap-3">
                <Alert tone="warning" title="No access yet">
                  {user.email || "This account"} is signed in but isn&apos;t a member of any organisation in Inquira. Sign out and use the owner email from setup, or ask the owner to add you.
                </Alert>
                <form action={signOut}><Button type="submit" variant="outline" className="w-full">Sign out</Button></form>
              </div>
            ) : (
              <>
                {linkError ? <Alert tone="danger" className="mb-4" title={linkError} /> : null}
                <LoginForm next={safeNext} dev={isDevAuth()} />
              </>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">There is no public sign-up. The owner account is created during setup; teammates are added by the owner.</p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { isLocalAuth } from "@/lib/env";
import { SetPasswordForm } from "../forms";

export const metadata: Metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/** Opened from a one-time sign-in link (local sign-in only). The token is checked when the form is sent. */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 text-xl font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">In</span>
          Inquira
        </div>
        <Card>
          <CardContent className="py-5">
            <h1 className="mb-1 text-lg font-semibold">Set your password</h1>
            <p className="mb-4 text-sm text-muted">Choose a password for Inquira. This link works once.</p>
            {!isLocalAuth() || !token ? (
              <Alert tone="danger" title="This link is not valid here. Ask an owner or admin for a new sign-in link." />
            ) : (
              <SetPasswordForm token={token} />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

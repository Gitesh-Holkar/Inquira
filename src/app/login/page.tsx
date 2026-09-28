import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/primitives";
import { getAppSession } from "@/lib/auth";
import { isDevAuth } from "@/lib/env";
import { LoginForm } from "./forms";
import { HashSessionHandler } from "@/components/auth/hash-session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getAppSession()) redirect("/");
  const { next } = await searchParams;
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
            <LoginForm next={next && next.startsWith("/") ? next : "/"} dev={isDevAuth()} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

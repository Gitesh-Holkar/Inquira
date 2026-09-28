"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, Field, Input } from "@/components/ui/primitives";
import { updatePassword, type AuthState } from "@/app/login/actions";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardContent className="grid gap-4 py-5">
          <h1 className="text-lg font-semibold">Set your password</h1>
          {state.error ? <Alert tone="danger" title={state.error} /> : null}
          <form action={action} className="grid gap-4">
            <Field label="New password" htmlFor="password" hint="At least 10 characters">
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
            </Field>
            <Field label="Repeat password" htmlFor="confirm">
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </Field>
            <Button type="submit" size="touch" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

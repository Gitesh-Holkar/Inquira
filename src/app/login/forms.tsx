"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/primitives";
import { devSignIn, sendReset, signIn, type AuthState } from "./actions";

export function LoginForm({ next, dev }: { next: string; dev: boolean }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(dev ? devSignIn : mode === "signin" ? signIn : sendReset, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      {state.message ? <Alert tone="success" title={state.message} /> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email ?? (dev ? "owner@example.com" : "")} />
      </Field>
      {!dev && mode === "signin" ? (
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Please wait…" : dev ? "Sign in (local dev)" : mode === "signin" ? "Sign in" : "Email me a link"}
      </Button>
      {!dev ? (
        <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={() => setMode(mode === "signin" ? "reset" : "signin")}>
          {mode === "signin" ? "Forgot password? / First time here?" : "Back to sign in"}
        </button>
      ) : (
        <p className="text-xs text-muted">AUTH_MODE=dev is on. This button never works in production.</p>
      )}
    </form>
  );
}

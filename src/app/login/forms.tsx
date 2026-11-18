"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/primitives";
import { createFirstOwnerAction, devSignIn, localSignIn, sendReset, setPasswordWithLinkAction, signIn, type AuthState } from "./actions";

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

/** Local sign-in (AUTH_MODE=local): email and password; a forgotten password needs a link from an owner or admin. */
export function LocalLoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(localSignIn, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email ?? ""} /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" size="touch" disabled={pending}>{pending ? "Please wait…" : "Sign in"}</Button>
      <p className="text-xs text-muted">Forgot your password? Ask an owner or admin for a sign-in link (Settings → Members). Owner: run <code>npm run local:sign-in-link -- you@example.com</code> on the computer that runs Inquira.</p>
    </form>
  );
}

function NewPasswordFields() {
  return (
    <>
      <Field label="Password (at least 10 characters)" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Field label="Password again" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} /></Field>
    </>
  );
}

/** First start of a local install: the first person creates the owner account. */
export function FirstOwnerForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(createFirstOwnerAction, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      <Field label="Your email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email ?? ""} /></Field>
      <NewPasswordFields />
      <Button type="submit" size="touch" disabled={pending}>{pending ? "Please wait…" : "Create owner account"}</Button>
    </form>
  );
}

/** The page a one-time sign-in link opens: choose a password, then you are signed in. */
export function SetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(setPasswordWithLinkAction, {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      <NewPasswordFields />
      <Button type="submit" size="touch" disabled={pending}>{pending ? "Please wait…" : "Set password and sign in"}</Button>
    </form>
  );
}


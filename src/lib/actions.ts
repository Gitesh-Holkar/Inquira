import { AppError, publicMessage } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Wraps a server action body: maps AppError → friendly result (never throws to the client). */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    // redirect()/notFound() from next/navigation must propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_")) throw e;
    const p = publicMessage(e);
    if (!(e instanceof AppError)) console.error(e);
    const fieldErrors = (p.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    return { ok: false, error: p.message, fieldErrors };
  }
}

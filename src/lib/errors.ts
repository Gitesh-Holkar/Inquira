export type AppErrorCode =
  | "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTEGRATION" | "RATE_LIMITED" | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You don't have permission to do that") => new AppError("FORBIDDEN", msg);

/** Safe message for users/tools; never leaks stack traces or SQL. */
export function publicMessage(err: unknown): { code: AppErrorCode; message: string; details?: unknown } {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details };
  return { code: "INTERNAL", message: "Something went wrong. Please try again." };
}

import { z } from "zod";
import { withSystemTx, withUserTx, type Tx } from "@/db/client";
import { AppError } from "@/lib/errors";
import { authorize, type Permission } from "./permissions";
import type { Ctx } from "./types";

/**
 * Runs `fn` inside one transaction for this actor. Humans run as the `authenticated`
 * role (RLS enforced); MCP/system actors run as owner with explicit org scoping.
 */
export function runTx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.actor.kind === "human" ? withUserTx(ctx.actor.userId, fn) : withSystemTx(fn);
}

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new AppError("VALIDATION", "Invalid input", z.flattenError(r.error));
  }
  return r.data;
}

/**
 * The one way to define a public service function: zod-validated input, permission check,
 * a transaction, and (inside the handler) audit + events. UI, MCP tools and cron jobs all call these.
 */
export function defineService<S extends z.ZodType, O>(def: {
  name: string;
  input: S;
  permission: Permission;
  handler: (ctx: Ctx, input: z.output<S>, tx: Tx) => Promise<O>;
}) {
  const fn = async (ctx: Ctx, raw: z.input<S>): Promise<O> => {
    const input = parseInput(def.input, raw);
    authorize(ctx, def.permission);
    return runTx(ctx, (tx) => def.handler(ctx, input, tx));
  };
  return Object.assign(fn, { serviceName: def.name, inputSchema: def.input, permission: def.permission });
}

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
 *
 * `runAs: "system"` is for services that touch system-only tables (integration_secrets), which the
 * `authenticated` role can never read. The permission check above still applies, the handler must
 * scope every query by ctx.orgId, and audit rows still name the real actor.
 */
export function defineService<S extends z.ZodType, O>(def: {
  name: string;
  input: S;
  permission: Permission;
  runAs?: "actor" | "system";
  handler: (ctx: Ctx, input: z.output<S>, tx: Tx) => Promise<O>;
}) {
  const fn = async (ctx: Ctx, raw: z.input<S>): Promise<O> => {
    const input = parseInput(def.input, raw);
    authorize(ctx, def.permission);
    return def.runAs === "system" ? withSystemTx((tx) => def.handler(ctx, input, tx)) : runTx(ctx, (tx) => def.handler(ctx, input, tx));
  };
  return Object.assign(fn, { serviceName: def.name, inputSchema: def.input, permission: def.permission });
}

/**
 * Like defineService, but without an outer transaction: for services that call external APIs
 * (Google, TradeIndia) and open their own short transactions, so no DB connection is held
 * while waiting on the network.
 */
export function defineExternalService<S extends z.ZodType, O>(def: {
  name: string;
  input: S;
  permission: Permission;
  handler: (ctx: Ctx, input: z.output<S>) => Promise<O>;
}) {
  const fn = async (ctx: Ctx, raw: z.input<S>): Promise<O> => {
    const input = parseInput(def.input, raw);
    authorize(ctx, def.permission);
    return def.handler(ctx, input);
  };
  return Object.assign(fn, { serviceName: def.name, inputSchema: def.input, permission: def.permission });
}

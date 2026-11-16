# ADR-001 — Stack versions

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The original brief fixed the stack. On 29 Sep 2026 the current majors were Next.js 16, React 19.3, TypeScript 7.0 (the new native compiler), zod 4, Vitest 5 and ESLint 10.

## Problem
Which versions to pin so that the build, the type check and the linter all work together.

## Options
- Latest of everything, including TypeScript 7 and ESLint 10.
- Next.js 15 with older tooling.
- Next.js 16 with TypeScript 5.9 and ESLint 9.

## Decision
Use Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind 4, Drizzle 0.45, zod 4, Vitest 5 and Playwright 1.63. Pin **TypeScript 5.9.3** and **ESLint 9.39**.

## Reasoning
TypeScript 7 drops the JavaScript compiler API that Next's build-time type check uses. `eslint-config-next` is tested against ESLint 9. Next.js 15 is older and close to the end of support.

## Consequences
Upgrade TypeScript once Next officially supports TypeScript 7. `next dev` writes a short agent-rules block into `AGENTS.md`; keep it (see ADR-019).

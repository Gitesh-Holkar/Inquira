# ADR-003 — Modules and one service kit

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The web UI, the MCP tools and the cron jobs all change the same data.

## Problem
How to make sure permission checks, validation and audit cannot be skipped by any caller.

## Options
- Each caller talks to the database itself.
- A shared service layer that every caller must use, enforced by lint rules.

## Decision
Code lives in `src/modules/<name>/{schema,service,types}.ts`. Public service functions are built with `defineService`, which validates input with zod, checks the permission, opens one transaction, and lets the handler write the audit row and events in that same transaction. Cross-module calls go through the other module's `…Internal(tx, ctx, …)` functions. ESLint enforces that a module cannot import another module's `schema` and that UI code cannot import `@/db` or any schema.

## Reasoning
One code path means permissions, validation and audit apply to every caller.

## Consequences
Server actions, MCP tools and jobs share the same functions. Services that touch `integration_secrets` use `runAs: "system"`; services that call external APIs use `defineExternalService`.

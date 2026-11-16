# ADR-011 — Development-only sign-in

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Supabase Auth is not reachable in local development and in Playwright runs.

## Problem
How to sign in during development without weakening deployed builds.

## Options
- A test account in the hosted project.
- A signed-cookie sign-in that only works in development.

## Decision
`AUTH_MODE=dev` enables a signed-cookie sign-in for local development and Playwright. It is refused when `NODE_ENV=production` or `VERCEL` is set.

## Reasoning
Tests need a signed-in user without network access.

## Consequences
GOAL G-PLT-1 and `AGENTS.md` rule 5 apply: no constant, flag or environment variable may sign a visitor in on a deployed build. A regression test enforces it.

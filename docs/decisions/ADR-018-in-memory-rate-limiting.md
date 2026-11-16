# ADR-018 — In-memory rate limiting

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Public endpoints need protection from casual abuse, and the default setup must cost nothing.

## Problem
Where to keep rate-limit counters.

## Options
- A hosted Redis.
- A token bucket in each serverless instance.

## Decision
A token bucket per serverless instance on client registration (10 a minute), the token endpoint (30), MCP (120), sign-in (10) and password reset (3), all per IP.

## Reasoning
Good enough against casual abuse with no extra service.

## Consequences
If traffic grows, add a shared limiter (see `docs/SECURITY.md`).

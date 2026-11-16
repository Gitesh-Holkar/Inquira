# ADR-017 — Gmail first sync reads 14 days

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
A sales mailbox holds thousands of messages.

## Problem
How much history the first Gmail sync should read.

## Options
- 30 days, like TradeIndia.
- 14 days.

## Decision
The first Gmail sync reads the last 14 days; TradeIndia's reads 30.

## Reasoning
Portal mail older than two weeks is rarely actionable, and a longer backfill could be thousands of messages.

## Consequences
Change `BACKFILL_DAYS` in `src/modules/sources/gmail/service.ts` if the owner wants more (QUESTIONS Q-007).

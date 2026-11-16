# ADR-012 — TradeIndia sync windows

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
TradeIndia's inquiry API has no public documentation and unknown limits.

## Problem
How to read it safely.

## Options
- One large date range.
- Small windows with pauses.

## Decision
Call the inquiry endpoint in 7-day windows, 50 rows a page, 1.5 seconds between calls. The first run reads 30 days; later runs read from two days before the last success. HTTP 429 means backoff; rejected credentials mean reconnect. Field names are read through alias lists.

## Reasoning
Conservative until the real limits are known.

## Consequences
Since 16 Nov 2026 the sync also saves its position after each window, stops at a time budget and builds dates in IST (milestone M0). See `docs/INTEGRATIONS.md`.

# ADR-009 — Lead de-duplication, including API and notification email copies

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
A portal enquiry can arrive through the API and again as a notification email.

## Problem
How to keep one record per enquiry (GOAL G-SRC-6).

## Options
- Fuzzy matching on name or company (too many false merges).
- A unique source reference, then a narrow contact-and-product window.

## Decision
There is a unique key on `(org_id, source, source_ref)`. For TradeIndia, `source_ref` is the `rfi_id`, which the email carries in the base64 `ext=` parameter of its link, so the API copy and the email copy collide exactly. When an email has no inquiry ID, `source_ref` is `gmail:<messageId>`; a later lead from the same source with the same phone or email and the same catalogue product (or the same product text) within 48 hours is merged, and an email-only reference is upgraded to the real inquiry ID.

## Reasoning
The same buyer asking for two different products should stay two leads.

## Consequences
Merges are recorded in `alternate_refs` with the method used.

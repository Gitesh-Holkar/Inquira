# ADR-022 — AI writing prices or free quotation text (GOAL R-3)

- **Status:** Rejected
- **Date:** 16 Nov 2026

## Context
AI could compose quotations directly.

## Problem
Whether a model may write a price or the quotation wording.

## Options
- Let the model compose quotations.
- Templates and the rate book write quotations; AI only fills fixed fields.

## Decision
Rejected. Quotations are rendered from templates and the rate book. AI returns schema-checked fields and never sets a price.

## Reasoning
A wrong price is a commitment to a customer.

## Consequences
Free-text replies in conversations are deferred and start as held drafts only (GOAL R-11).

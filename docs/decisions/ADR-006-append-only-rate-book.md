# ADR-006 — Append-only rate book; rates imported as GST-exclusive, ex-factory

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Quotations are commitments, so the price that was quoted must stay provable.

## Problem
How to store rates so history is never lost, and how to read the first rates file, which did not say whether prices include GST.

## Options
- A `valid_to` column updated in place (mutation; loses the audit trail).
- Insert-only entries where the newest valid entry wins.

## Decision
`price_entries` can only be inserted into; a trigger rejects UPDATE and DELETE. The current rate for a grade is the newest entry that is valid today. Every quotation stores a snapshot of the exact entries it used. The import uses `gst_inclusive=false` and basis `Ex-factory`.

## Reasoning
The company's own sent quotations quote the same numbers with "GST x% extra" and "Ex-Factory". The owner confirmed ex-factory rates on 16 Nov 2026.

## Consequences
Corrections are new entries. A back-dated entry is refused because it would never become current.

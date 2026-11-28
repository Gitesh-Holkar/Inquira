# ADR-030: IndiaMART through Push plus Pull, with email as the cross-check

- **Status:** Accepted
- **Date:** 18 Nov 2026
- **Requirement:** GOAL G-SRC-1, G-SRC-2, G-SRC-6, G-SRC-7, G-SRC-8

## Context

IndiaMART leads reached Inquira only as notification emails, parsed from layouts that change. The company now has IndiaMART's Lead Manager APIs: Push (IndiaMART posts each lead to an https address) and Pull (a key, one call per 5 minutes, 7 days per call, 365 days of history).

## Problem

Which route is the source of truth, how are the routes combined without duplicate leads, and how is the push address protected when IndiaMART documents no signature?

## Options

1. Pull only. Simple, but leads arrive up to 10 minutes late.
2. Push only. Instant, but no history and nothing catches a missed push (and IndiaMART switches push off after 48 hours of refusals).
3. **Push and Pull, plus email.** Push for speed, Pull for history and gaps, email as an independent count.

## Decision

Option 3. `UNIQUE_QUERY_ID` is the lead's `source_ref`, so push and pull of one lead are one record; the notification email merges by buyer and product within 48 hours and the lead keeps the email as an alternate. The push address ends with a random secret (24 bytes); only its SHA-256 is stored and it is shown once; a new address replaces the old. The pull respects IndiaMART's limits itself (one call per 5 minutes, recorded before each call) and loads the first 30 days one week per run. The dashboard compares API and email arrivals per portal and flags leads that came only by email while the API is connected.

## Reasoning

Each route covers the other's failure. A secret path is the only authentication IndiaMART's push supports; making it long, random, hashed and replaceable keeps it as safe as a token. Recording the call time before calling keeps the 5-minute rule even when a run is killed.

## Consequences

- Push needs the public https site; a computer-only install uses Pull and email.
- Field names come from IndiaMART's help pages; the Pull API is assumed to return the same fields as Push (QUESTIONS.md Q-019). The raw lead is stored, so leads can be re-read if a name differs.
- The first load is 30 days, not 365, so old leads do not flood the inbox as new; changeable later.

## Update, 28 Nov 2026

The owner received only a Push key from IndiaMART, and the Settings card asked for a Pull key first, while Push alone never marked IndiaMART connected. Within this decision (Push and Pull, plus email): Push is now step 1 and enough on its own; the first pushed lead marks IndiaMART connected; the Pull key is an optional step 2. The "CRM Push key" IndiaMART gives is not used (its documented push carries no key). A request with no lead (IndiaMART's Test button needs a 200) is acknowledged and recorded on the card instead of refused, so IndiaMART does not switch Push off after 48 hours of refusals if its format changes; the notification emails remain the cross-check.

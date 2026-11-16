# ADR-008 — Contact de-duplication

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The same buyer writes through several portals, and several companies can share one phone number.

## Problem
When two enquiries belong to the same contact.

## Options
- Fuzzy matching on names and companies.
- Exact match on email, then phone.

## Decision
Match lowercase email first, then E.164 phone. Portal placeholder emails such as `noreply@noreply.tradeindia.com` are dropped. Existing contact fields are never overwritten; only empty ones are filled. Each lead keeps its own company name.

## Reasoning
Exact matching avoids false merges; keeping the company on the lead avoids merging different companies that share a number.

## Consequences
Contacts sharing a mobile number are one contact but show their own company on each lead.

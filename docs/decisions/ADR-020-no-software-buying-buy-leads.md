# ADR-020 — Software selecting or buying IndiaMART Buy Leads (GOAL R-1)

- **Status:** Rejected
- **Date:** 16 Nov 2026

## Context
The first version described a scheduled Claude Cowork task that opened IndiaMART's seller panel in a browser and clicked "Contact Buyer Now" on matching Buy Leads.

## Problem
Whether software may choose or buy Buy Leads on the seller account.

## Options
- A browser-automation task that clicks for the team.
- A person chooses and clicks; Inquira keeps the rules and the decision log, and records Buy Leads once they are consumed.

## Decision
Rejected. No code and no agent task clicks, selects or buys on IndiaMART.

## Reasoning
IndiaMART's API does not offer it, and browser automation risks the paid seller account.

## Consequences
`docs/COWORK_INDIAMART_TASK.md` is rewritten as a suggestions-only guide. The Buy Lead rules, the decision log and the MCP tools stay. Reopen only with IndiaMART's written permission.

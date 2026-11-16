# ADR-024 — n8n or Make as the backbone (GOAL R-6)

- **Status:** Rejected
- **Date:** 16 Nov 2026

## Context
Workflow tools can connect portals, mail and AI quickly.

## Problem
Whether to build Inquira's flows in n8n or Make.

## Options
- A workflow tool as the backbone.
- One codebase with modules, jobs and adapters.

## Decision
Rejected.

## Reasoning
It would split the logic across two places, and n8n's licence restricts offering it to customers.

## Consequences
Background work stays in the job table (ADR-007).

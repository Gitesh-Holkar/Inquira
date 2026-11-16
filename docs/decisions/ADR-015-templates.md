# ADR-015 — Templates

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Quotation text is edited by the team in the app.

## Problem
How to keep template editing safe and the output predictable.

## Options
- A template language with logic.
- Plain placeholders.

## Decision
Templates are plain `{{placeholder}}` substitution with no logic. Unknown placeholders are rejected. A sign-off in the last lines is rejected because the real Gmail signature is appended when the draft is created.

## Reasoning
No logic means nothing in a template can run code or surprise the team.

## Consequences
Company wording is data. Default texts are generic; the company's own wording belongs in its seed set.

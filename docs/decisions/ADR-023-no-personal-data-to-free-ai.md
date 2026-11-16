# ADR-023 — Sending personal data to a free AI tier (GOAL R-4)

- **Status:** Rejected
- **Date:** 16 Nov 2026

## Context
The Basic AI tier defaults to a free Gemini key.

## Problem
Whether buyer names, phone numbers or emails may be sent to a free tier.

## Options
- Send the full lead text.
- Redact before every Basic-tier call.

## Decision
Rejected. Basic-tier input is redacted: no email, phone number, URL, buyer name or company.

## Reasoning
The free tier's terms exclude personal and confidential data and allow the provider to use submitted content.

## Consequences
A test must prove that no personal data reaches the Basic provider (GOAL G-AI-4).

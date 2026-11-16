# ADR-021 — Automating WhatsApp Web or the desktop app (GOAL R-2)

- **Status:** Rejected
- **Date:** 16 Nov 2026

## Context
WhatsApp is the fastest channel for many buyers.

## Problem
Whether to automate pressing Send in WhatsApp Web or the desktop app.

## Options
- Automate the web or desktop client.
- A tap-to-send link now; Meta's official Cloud API later.

## Decision
Rejected. Inquira opens a pre-filled chat link and a person taps Send. Automation, if approved later, uses the official Cloud API behind an adapter (GOAL G-OUT-8).

## Reasoning
Client automation breaks WhatsApp's terms and risks a ban on the business number.

## Consequences
No code drives a WhatsApp client.

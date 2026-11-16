# ADR-010 — Gmail access: `gmail.readonly` and `gmail.compose`, drafts only

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The app reads mail, reads the signature and creates quotation drafts.

## Problem
Which Google permissions to request and how to guarantee the app does not send.

## Options
- Full mail access.
- The documented minimum: `gmail.readonly` plus `gmail.compose`.

## Decision
Request exactly `gmail.readonly` (read, history, send-as signature) and `gmail.compose` (`drafts.create`). The client has **no send method**, and the test fake throws if any send endpoint is called. The refresh token is encrypted with AES-256-GCM. OAuth uses PKCE plus a hashed, single-use, 10-minute `state` bound to the user.

## Reasoning
Google has no drafts-only permission, so the guarantee comes from our code.

## Consequences
This stays in force until the outbound pipeline (GOAL G-OUT, milestone M7) is merged; that pull request will mark this record Superseded and link its replacement.

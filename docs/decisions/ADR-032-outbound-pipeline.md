# ADR-032: One outbound pipeline with hold rules and modes; sending only through it

- **Status:** Accepted
- **Date:** 22 Nov 2026
- **Requirement:** GOAL G-OUT-1 to G-OUT-7, G-OUT-9, G-OUT-10, G-TPL-1 to G-TPL-3, G-CNV-2, G-CNV-3, G-FUP-1 (milestone M7)
- **Supersedes:** [ADR-010](ADR-010-gmail-drafts-only.md) (drafts only)

## Context

Until now Inquira only created Gmail drafts and a person clicked Send in Gmail (ADR-010). The goal asks for replies that are prepared at once, checked by written rules, and sent by a person or, once the owner trusts them, automatically for the simplest cases. AGENTS rule 4 says that once this pipeline exists it must be the only code path that sends, start in `shadow`, and tests must fail if anything else sends.

## Problem

How to send without ever sending something a person would not have sent, while keeping every step visible and reversible.

## Options

1. Keep drafts only. Safe, but every enquiry waits for a person, and nothing can be measured before switching on automation.
2. Send automatically whatever the template produces. Fast, but one wrong rate or one unanswered question reaches a buyer.
3. **A record per message (draft → held → approved → sent / failed / cancelled), written hold rules in code, a mode per channel that starts in shadow, and one send function.**

## Decision

Option 3.

- Every message is a row in `outgoing_messages` with its purpose, channel, state, hold reasons, mode, rule-set version, template version, rate entries, documents, and who approved and sent it.
- **Hold rules** (`src/modules/outbound/hold-rules.ts`) are pure functions, each with a test. Any match holds the message and the reason is shown. The team can add its own rules from a correction.
- **Modes** per company for email: `shadow` (default: a person sends everything), `assisted` (clean first quotations go automatically), `automatic` (also document replies and follow-ups). Only an owner changes the mode; it is audited. WhatsApp stays a person's tap (G-OUT-7) until the Cloud API is approved (G-OUT-8).
- **Automatic sending** happens in the `outbound.send` job only: inside the send window, under hourly and daily caps, not while paused, and after the rules are checked again just before sending.
- **One send path:** `src/modules/outbound/send.ts` is the only caller of `GmailClient.sendMessage`. A test scans `src/` and fails if any other file calls it; the Google fake throws on any send unless a test allows it. The scope stays `gmail.compose`, which Google already granted, so no reconnection is needed.
- The existing "Create quote draft" button stays (a Gmail draft a person sends from Gmail). Using it cancels the pipeline's pending quotation for that lead, so a buyer never gets two.
- AI or Claude may write replies to conversations, but they always start held (G-CNV-3), and a price in their text is flagged.

## Reasoning

Rules in code make "unsure" a list of checks, not a model's opinion (GOAL P2). Shadow mode lets the owner see two weeks of what would have gone out before trusting it (GOAL phase 3 gate). Re-checking at send time covers what changed after preparing: a buyer reply, an expired rate.

## Consequences

- ADR-010's "the client has no send method" no longer holds; its guarantee moves to the single send path and its test.
- New tables `outgoing_messages`, `outbound_rules`, `notifications`, `template_versions`; templates get `purpose` and `version` (migrations 0013, 0014).
- The owner decides when to leave shadow mode (Settings → Sending); nothing changes for buyers until then.

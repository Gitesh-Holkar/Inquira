# ADR-031: AI tiers behind one provider interface, rules first, code decides

- **Status:** Accepted
- **Date:** 18 Nov 2026
- **Requirement:** GOAL G-AI-1 to G-AI-10, G-UND-3, G-UND-4 (milestone M5)

## Context

Leads arrive with a product the alias matcher cannot place ("plant protein for our bakery"), with no stated purpose, and with quantities such as "4 bags of 25 kg". Emails the rules cannot classify wait in Review for a person or the Claude connector. The goal asks for two AI tiers the company configures itself: Basic (a free Gemini key, redacted input) and Advanced (a paid key such as Claude), plus the existing connector.

## Problem

How to add AI without making it a dependency (every key off must still work), without letting a model change data on its own say-so, without sending personal data to a free tier, and without tying the code to one provider.

## Options

1. One provider SDK called from the lead and email code. Fast to write; ties the code to a provider and spreads model calls everywhere.
2. **One `ai` module with a provider interface, a job that walks rules → Basic → Advanced → review, and code that checks every answer.**
3. Send everything to the Claude connector only. No keys needed, but nothing happens until Claude runs (hourly at best).

## Decision

Option 2.

- **Providers.** `src/modules/ai/providers/` holds one adapter per provider (Gemini, Anthropic, OpenAI-compatible) behind `AiProvider.complete()`. Each is plain HTTPS through `fetch`: the repository adds no dependency without the owner's approval, and the three APIs are small. The Anthropic SDK can replace its adapter file alone if the owner approves it.
- **Settings.** Each tier is an integration row (`ai_basic`, `ai_advanced`) with provider, model name, address, confidence threshold and daily call limit in `config`, and its key encrypted in `integration_secrets` like the TradeIndia key. Model names are settings only.
- **Order.** Rules run when the lead arrives (alias match, intent wording, weight units). Whatever is open is handled by the `ai.work` job: Basic, then Advanced, then the review queue (Leads → Needs details; Emails → Review). A tier that is off, has no key, is backing off after an error, or has used its daily calls is skipped at once.
- **Code decides.** Every task has a fixed JSON schema checked with zod (`tasks.ts`). A field is written only when it was empty, the reply passed the schema, the value exists (a product ref from the list sent, an intent from the fixed list, a weight only when the text states one) and the confidence reaches the company's threshold. AI writes run as actor `ai:<tier>`, which passes no permission check, so a model can never reach a public service. A person's later edit marks the AI decision corrected.
- **Redaction.** Basic receives only the product, quantity, subject and requirement text with emails, phones, links, tax ids and the buyer's name, company and city removed (`redact.ts`), plus the catalogue. Advanced reads review emails in full, so it is meant for a paid key with private terms.
- **Untrusted text.** Buyer text sits between markers it cannot close, and the system prompt says it is data. The tests include an injection message.
- **Log.** Every decision is a row in `ai_decisions` (task, tier, provider, model, confidence, outcome, tokens, correction). The dashboard shows accuracy per tier as (filled − corrected) / filled.

## Reasoning

Rules first keeps the free tier for the hard cases and makes the system work with no AI. A provider interface keeps model choice a setting. Checking answers in code is what makes it safe to let a model fill fields at all: the model can only choose among values the code already accepts. Moving on at once after an error (instead of retrying) means an outage costs one run, and the review queue loses nothing.

## Consequences

- New tables and columns: `ai_decisions`; `leads.intent`, `leads.filled_by`, `leads.understood_at`; `email_messages.ai_checked_at`; integration providers `ai_basic`, `ai_advanced` (migrations 0010, 0011).
- The Claude connector gains two tools for the new queue (`list_leads_needing_details`, `submit_lead_details`) and the `leads.edit` permission, used only by `submit_lead_details`, which fills empty fields and never overwrites.
- Leads older than 7 days are not sent to AI. Basic sees no whole email threads.
- Not yet: Advanced reading a conversation and drafting non-template replies (G-CNV-3, with the outbound pipeline, M7) and Advanced suggesting Buy Lead decisions (the connector does this today).
- Live behaviour of each provider is checked by the owner with their own key (Settings → AI → Test connection); the tests use fakes only.

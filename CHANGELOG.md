# Changelog

What a user or an operator would notice, newest first. Internal refactors are not listed.

## Unreleased

### 16 Nov 2026 — Sign-in is back on (M0)
- **Sign-in is required again.** The testing switch from 2 Oct is removed, together with a second switch that could have enabled development sign-in on a production build.
- A test now fails the build if any page, action or the Claude consent screen can be reached without signing in.
- **Owner action needed:** revoke the tokens issued while sign-in was off and review what changed. Steps are in `docs/RUNBOOK.md` section 1.

### 16 Nov 2026 — Handover and documentation structure
- The project's goal is now `docs/GOAL.md`, with a requirement ID for every item. `AGENTS.md` is the single rulebook; `CLAUDE.md` only imports it.
- New documents: `docs/INDEX.md`, `docs/DATABASE.md`, `docs/INTEGRATIONS.md`, `docs/API.md`, `docs/TESTING.md`, and one file per decision in `docs/decisions/`.
- Decided: no software selects or buys IndiaMART Buy Leads, no automation of WhatsApp clients, no AI-written prices, no personal data to a free AI tier, no workflow tool as the backbone (ADR-020 to ADR-024).
- No change to how the app behaves in this entry.

## 0.1.0 — First version (29 Sep to 2 Oct 2026)
- Lead inbox and lead page with WhatsApp, call, copy, notes, status history and audit trail.
- Gmail sync with parsers for IndiaMART and TradeIndia notification emails; TradeIndia inquiry API sync; one lead per enquiry.
- Review queue for unclear emails, with rules made from corrections.
- Append-only rate book with a bulk editor; quotation drafts in the enquiry's Gmail thread with the mailbox signature.
- Claude connector (MCP) with OAuth and manual tokens; Buy Lead rules and decision log.
- Dashboard with reconciliation and integration health.
- 2 Oct 2026: saving Gmail and TradeIndia credentials fixed for signed-in users; clearer sign-in messages; sync time budgets; dead code removed.
- 2 Oct 2026: sign-in was switched off for testing at the owner's request. **This is reversed in milestone M0.**

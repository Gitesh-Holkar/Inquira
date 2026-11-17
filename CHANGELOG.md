# Changelog

What a user or an operator would notice, newest first. Internal refactors are not listed.

## Unreleased

### 17 Nov 2026 — Feature check: finish what was half-built
- **Buy Leads are suggestions only.** Claude reads your rules and suggests which IndiaMART Buy Leads match; a person clicks on IndiaMART. The "test mode / live mode" switch is gone, the daily number is now "Suggestions per day", and the connector can no longer log a lead as contacted. `docs/COWORK_INDIAMART_TASK.md` is rewritten; **do not run the earlier prompt that clicked for you.**
- **Rates → Edit product:** correct a product's name, category, the other names buyers use, rename a grade or add one. Adding a product with a name that already exists now says so.
- **Lead page → Delete** (owners and admins), for spam, tests and duplicates.
- Removed a settings input that nothing read (feature switches).

### 17 Nov 2026 — Price list import and quotation terms (M3, up to the owner's confirmation)
- **Rates → Import price list.** Paste a price list, read what would change (new products, price changes, renames, anything that cannot be written and why), then apply. Old rates stay in history. A line with no known GST rate is left out instead of guessed.
- **Quotations print the company's terms:** MOQ and pack size from the rate, and a new **Payment terms** setting (Settings → Organisation), for example "100% advance". An empty value drops its line.
- `npm run rates:import -- <list.txt>` shows the same changes from a file and writes only with `--confirm`.
- Seeding reads one folder (`SEED_DIR`, default `seed/stdm`): company name and terms, catalogue, and the newest price list. `seed/rates.json` is replaced by the price list itself.
- **A deployment now stops, instead of breaking the site, when the database needs a change first.** Vercel shows it as failed with "Inquira build stopped: the database is missing … migration(s)", and the previous version keeps running (`docs/SETUP.md` section 11).
- **Not live yet:** this update needs two database additions (migrations 0003 and 0004), so the live site stays on the previous version until they are applied. The November 2026 list (14 price changes, 10 new rates) then waits for the owner's confirmation on the import screen (`QUESTIONS.md` Q-015).

### 17 Nov 2026 — Audit fixes (M0)
- **IndiaMART emails:** enquiries from `buyershelpdesk@indiamart.com` now get their product and requirements; Buy Lead emails with several details on one line no longer run the values together; Buy Lead emails in the HTML-only layout now get the buyer's city, state and product; the daily "BuyLeads allocated" notice is ignored and no longer lands in the review queue.
- **TradeIndia emails:** the placeholders "New Buyer" and "numbermasking-inquiry-…" are no longer stored as a buyer's name or company.
- **TradeIndia sync:** the first 30-day load now continues across runs (it could restart from the beginning after a timeout); request dates use IST; an enquiry that fails to save is retried and reported, and the sync no longer moves past it silently.
- **Gmail sync:** a backlog left by one run is always picked up on the next run. "Sync now" says when more is still to come.

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

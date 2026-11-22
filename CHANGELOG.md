# Changelog

What a user or an operator would notice, newest first. Internal refactors are not listed.

## Unreleased

### 22 Nov 2026 — Reports, daily summary, backups, open-source files (M8)
- **Dashboard → Last 7 days:** leads received and matched to a product, replies sent by people and automatically, what is held or ready now, emails set aside, and the typical time to first reply.
- **Daily summary email** (Settings → Sending, off until you switch it on): each evening after 7:30 PM IST the owners, or the addresses you enter, get the day's numbers from your Gmail. It stops while sending is paused.
- **Settings → Backups:** a backup of all your data (leads, emails, quotations, rates and history, templates, documents, members, audit log) every night after 1 AM IST, kept 14 days. Owners can **Back up now** and **Download** any of them; keys and passwords are never inside. The screen warns when file storage is not set up. Restoring is one command (`docs/RUNBOOK.md` section 5).
- For people who find the project: a clearer **README**, **CONTRIBUTING.md** (how to run it and make a change) and **SECURITY.md** (how to report a security problem privately). Every test run now also scans every file for keys, tokens and real phone numbers.
- A new local install starts with the fictional example company by default (`.env.example`).
- Database: migrations 0015 and 0016.

### 22 Nov 2026 — Replies prepared for you: the Outbox (M7, starts in shadow mode)
- **Outbox** (new menu item): for every new enquiry Inquira prepares the reply from your template, today's rate and the product's terms, by email (when the buyer has a real email) and WhatsApp (when there is a phone). Document requests get the latest valid COA or TDS attached; sample requests use your sample policy; below-MOQ enquiries get the below-MOQ reply; international enquiries an acknowledgement.
- **Held** messages say why (no product match, no quantity, below MOQ, outside India, no or flagged rate, a blank term, a question the template does not answer, an ongoing conversation, an existing customer, talk of discount, credit, complaint or a purchase order, an attachment, already sent, …). **Send**, **Edit** or **Don't send**; "Don't send" can become a rule, for example "always hold messages to anyone at this company".
- **Sending:** email goes from your Gmail with your signature, in the buyer's thread; WhatsApp opens the chat with the text filled in. Every send records the rules, template version and rates used.
- **Settings → Sending:** mode **shadow** (default: a person sends everything), **assisted** (clean first quotations go automatically) or **automatic** (also documents and follow-ups). Only an owner can change the mode. Send window, hourly and daily limits, and one **pause** switch. Follow-ups after a set number of days without a reply.
- **Templates:** one text per kind of message (first quotation, detailed quotation, documents, sample reply, below-MOQ reply, follow-up, international acknowledgement), email and WhatsApp; every save is kept as a version.
- Replies to buyers in a conversation: with Advanced AI on, a draft reply waits in the Outbox (always held); Claude can write one too (new connector tool).
- **Bell** (top right): held messages, failed sends and buyer replies, each told once.
- On phones, **More** lists every page you may open.
- Database: migrations 0013 and 0014.

### 22 Nov 2026 — Product terms, rate validity, sample policy, lead score (M6)
- **Rates → Edit product:** HSN code, lead time, payment terms for that product (otherwise the company's), and whether free samples are offered. Filled terms appear on quotations; an empty term a reply needs makes that reply wait for a person.
- **Rates:** an optional **Valid until** date (after it the rate stops and quotes need a new one) and an internal **lowest / highest price** per grade, shown in the rate history and never on a quotation.
- **Settings → Organisation → Sample policy:** free sample size, the details a buyer must send, and a note. Sample replies wait for a person until it is filled.
- **Lead score** from 0 to 100 on every lead (product matched, quantity against MOQ, phone, email, company, a buying request), with the reasons on the lead page. Leads → **Best score first** sorts by it. Scores refresh every night.
- Database: migration 0012.

### 18 Nov 2026 — AI that fills in leads (M5, waiting for the owner's key)
- **Settings → AI:** two optional tiers. Basic (for example a free Gemini key) finds the product when the name matches no alias and fills what the buyer wants and the quantity in kg; it never sees the buyer's email, phone, name, company or city. Advanced (for example a Claude API key) does the same for what Basic could not settle and sorts emails waiting in Review. Choose provider and model, set how sure it must be and how many calls a day it may make; **Test connection** checks the key. Steps: `docs/SETUP.md` section 6b.
- **Leads** now show what the buyer wants (new enquiry, documents, sample, price negotiation, order, complaint, not a buyer), the quantity in kg with **Below MOQ** when it is under the product's MOQ, and who filled each of these (rule, AI or a person). Filter by request type; edit both on the lead.
- **Leads → Needs details:** leads without a product or request type after rules and AI, for you or Claude to finish.
- AI only fills empty fields and never sends or prices anything. With both tiers off everything works on rules alone.
- **Dashboard → AI, last 30 days:** how many fields each tier filled and how many you corrected.
- Claude connector: two new tools for the Needs details queue.
- Database: migrations 0010 and 0011.

### 18 Nov 2026 — IndiaMART API (M4, waiting for the owner to connect it)
- **Settings → Integrations → IndiaMART:** paste the Pull API key and test it; create the push address to paste into IndiaMART's Lead Manager. Setup steps: `docs/SETUP.md` section 6a.
- Leads then arrive within seconds (push) and are checked every 10 minutes (pull); the first pull loads the last 30 days.
- Direct enquiries, bought Buy Leads, calls, catalogue views and WhatsApp enquiries are labelled on each lead.
- The same enquiry by API and by notification email is one lead.
- **Dashboard → API and email today** counts how leads arrived per portal and flags leads the API missed.
- Database: migration 0009.

### 18 Nov 2026 — Run Inquira on your own computer (M2)
- **`docker compose up -d`** starts Inquira with its own database, sign-in and scheduler; open http://localhost:3000. The first time, you create the owner account with a password. Guide: `docs/SELF_HOSTING.md`.
- A fictional example company is loaded by default; `SEED_DIR=seed/stdm` loads your own products, prices and terms.
- In local mode there is no email: adding a teammate shows a one-time link that lets them set a password. **Sign-in link** on the Members screen makes a new one for a forgotten password; the owner has a recovery command.
- Uploaded documents are kept on disk; keys are created on the first start and kept between restarts.
- The cloud version is unchanged.

### 18 Nov 2026 — Roles QA and Accounts; custom access per person
- **New roles:** QA (adds and removes product documents, views everything else) and Accounts (views leads, quotations, prices and documents; no settings).
- **Settings → Members → Access:** owners and admins switch single abilities on or off for a person on top of their role, for example let QA change prices, or take quotation drafts away from someone. You can only give what you have; owners always keep full access.
- Menus show only the pages a person may open; opening another page explains why it is not available.
- The database enforces the same access as the app (migrations 0007 and 0008).

### 17 Nov 2026 — Members screen and document library
- **Settings → Members:** add a teammate by email with a role (owner, admin, sales, viewer), change a role, or remove someone, without SQL. The screen tells you what to send the new person. Nobody can remove themselves, and a company always keeps an owner.
- **Documents** (new menu item; on a phone under Settings): upload COA, TDS, MSDS, specifications, brochures and certificates per product (or for the whole company) with batch, issue and expiry dates; filter, download and remove. PDF, images, Word and Excel up to 4 MB; files are checked by their content.
- **Quotations attach documents:** when valid documents exist for the lead's product, Create quote draft asks which to attach and adds the newest valid file of each type to the Gmail draft. An expired file is never attached. The lead page also links the valid documents for download.
- Needs `SUPABASE_SERVICE_ROLE_KEY` on the host (already listed in `docs/SETUP.md` section 2); without it both screens say what to set.
- Database: migrations 0005 and 0006 (the `documents` table and its access rules).

### 17 Nov 2026 — Owner's answers; remove a product
- **Rates → Edit product → Remove product** for a discontinued product: it leaves rates, quotations, lead matching and Buy Lead suggestions, and keeps its history. **Removed products** at the bottom of the Rates screen restores it.
- Lecithin rates are 18% GST as the price list says, without a "Confirm" mark (owner's answer). Pea Fiber (Insoluble) ₹185 confirmed.
- The live database has the two new columns (migrations 0003 and 0004), so this version deploys.
- No licence for now (owner's decision); the open-source release waits.

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

# Open questions for Gitesh

Each item lists the question, what I assumed so the build could continue, and where it matters in the code.

## Q-001 — Do rates include GST? (answered 16 Nov 2026)
- **Your answer:** every rate is ex-factory; proteins carry 18% GST and the rest 5%. So GST is charged on top of the listed rate, as assumed.
- **In the app:** each rate stores its GST %, and quotations print "GST x% extra". One point is still open: lecithin (Q-015).

## Q-002 — MOQ per product? (answered 16 Nov 2026)
- **Your answer:** MOQ is 100 kg for every product; payment terms are 100% advance.
- **In the app:** the November price list import sets MOQ 100 kg on every rate; payment terms are a setting (Settings → Organisation → Payment terms) printed on every quotation. Both take effect on the live site after Q-015.

## Q-003 — Website vs rates file naming (resolved: website crawled)
- **What happened:** Once the network was opened, I crawled stdmfood.com's 50 product pages and merged them into `seed/products.json`.
  - 47 site pages map onto rates-file products; their site names are kept as aliases and URLs.
  - 5 products are on the website only, so they're imported **without a price**: Lupine Protein Isolate, Modified Starch, Modified Potato Starch, Resistant Modified Starch, Pea Dextrin Powder.
  - The lecithins, oligosaccharides, E1404, Corn/Pea/Oat Fiber and Spirulina are in the rates file but not on the website.
  - Carboxymethyl Starch (CMS) no longer exists on the site (redirects), so it was dropped.
- **Please confirm** these names that disagree between the two sources:
  1. Quinoa: website says *Concentrate Protein*, rates say *Isolate Protein*.
  2. Oats: website says *Concentrate Protein*, rates say *Isolate Protein*.
  3. Lentil: website says *Protein Concentrate*, rates say *Isolate Protein*.
  4. Hemp: website says *Seed Concentrate Protein Powder*, rates say *Seed Protein Powder*.
  5. Website "Resistant Starch" is mapped to rates "Resistant Potato Starch".
- **Where it matters:**
  - Product names in quotes: `seed/products.json`, the *Catalog* screen.
  - Buy-lead matching: the aliases.
- **To re-check later:** run `npm run seed:website`.

## Q-004 — Supabase from the build container (resolved)
- **Status:** Verified from a fresh session: project in ap-south-1, Postgres 17.6, Auth OK.
- **How the build works around it:** The overnight build container can't see environment variables added after it started. So it develops and tests against a local Postgres that mimics Supabase (`npm run db:local:up`), and it applies migrations to the real project from a fresh session with `npm run db:remote:apply` (Management API over HTTPS).
- **From your machine:** `npm run db:migrate` works directly (see SETUP.md).

## Q-005 — Rates flagged `needs_confirmation` (closed by the November list, except lecithin)
1. **Spirulina Protein Powder "(White)":** kept exactly as your list prints it. No answer needed.
2. **Soya Isoflavones (₹1200):** 18% like the lecithins (answered 17 Nov 2026).
3. **Oats Fiber:** the November list has both lines, so this is settled: Oat Fiber ₹400 and Oat Fiber (Insoluble) ₹195.
4. **Soya Flour pack size:** kept as your list's GST section prints it, "25/50 Kg". Say so if quotations should say "25 Kg" only.

## Q-006 — Salesperson name in notifications
- **Question:** IndiaMART and TradeIndia greet a named salesperson. Should drafts be addressed from a specific person?
- **Assumed:** Parsers never depend on that name. The draft's From address is the Gmail account's default send-as identity, with its display name and signature.

## Q-007 — Gmail first sync reads 14 days
- **Question:** The first Gmail sync reads 14 days (TradeIndia: 30). Do you want a longer history?
- **Where it matters:** `BACKFILL_DAYS` in `src/modules/sources/gmail/service.ts` (ADR-017).

## Q-008 — Owner email value
- **What happened:** `SEED_OWNER_EMAIL` in the cloud environment contained angle brackets. The seed script now extracts the address, and the owner account was created from it.
- **Please check:** Make sure that's the address you want to sign in with. If not, add another user (SETUP §4).

## Q-009 — Quotes for buyers without an email address
- **Question:** IndiaMART often says "Email: Not Provided". For those leads the Gmail draft is created in the notification thread **with no recipient**, and you add one or use WhatsApp instead. Is that OK, or should such leads default to WhatsApp only?
- **Where it matters:** `src/modules/quotes/service.ts` (`to: lead.email`).

## Q-010 — Replying to portal notification threads
- **Question:** Drafts for portal leads are created in the portal notification's Gmail thread (so they're easy to find) but addressed **to the buyer's email**, not the portal. Is that how you reply today?

## Q-011 — Password-reset emails
- **Question:** Supabase's built-in mailer only sends a few emails per hour, which is fine for one owner. Before inviting a team, set up custom SMTP (Supabase → Authentication → Emails → SMTP). Do you have an SMTP provider?

## Q-012 — Inviting teammates (done 17 Nov 2026)
- Settings → Members adds, changes and removes people without SQL (`docs/SETUP.md` section 4).

## Q-013 — Scheduled resume
- **What happened:** The 04:10 IST resume is scheduled (trigger `trig_01MkFUSSb63XEULCu98HgQZQ`). The build finished before it fired, so that run will just re-check and exit.

## Q-014 — One raw IndiaMART "helpdesk" enquiry email
- **Question:** Please forward (or export as `.eml`) one email from `buyershelpdesk@indiamart.com` with a subject like "Enquiry for <product> from <name>" (no "via IndiaMART").
- **Why:** The parser for this layout was built from a description. `fixtures/emails/indiamart-enquiry-helpdesk.json` is marked `reconstructed`; the part after the requirement list is assumed to match the usual enquiry email.
- **Assumed meanwhile:** The buyer block (name, company, "Click to call", email, address) has the same shape as in `buyershelp+enq@` emails. If it differs, the lead is still created but with fewer fields.
- **Where it matters:** `parseEnquiry` in `src/modules/email/parsers/indiamart.ts`.

## Q-015 — November price list (16 Nov 2026): answered 17 Nov 2026
- **Answers:** lecithin (and Soya Isoflavones, listed under it) is **18%** GST; Pea Fiber (Insoluble) at **₹185** is correct. The "Confirm" mark on the lecithin rates is removed from the mapping.
- **Still to do by the owner in the app:** the steps under "How it goes live" below. Nothing has been written to the live rates yet.

**What the new list changes** (80 lines read, none unreadable; produced by the import itself against a copy of your September data):

- **New products (8):** Pea Protein Concentrate (80%) ₹340, Whey Protein Concentrate (80%) ₹2500, Hydrolysed Pea Protein ₹1600, Hydrolysed Brown Rice Protein ₹1800, Hydrolysed Peanut Protein ₹1800, Mung Starch ₹105, Resistant Dextrin ₹350, Inulin Powder ₹450.
- **First rate for products already in the catalogue (2):** Lupine Protein Isolate ₹550 (your list says "Lupin Isolate Protein"), Oat Fiber ₹400 (your list says "Oats Fiber").
- **Price changes (14):**

  | Product | September | November |
  | --- | --- | --- |
  | Peanut Flour | ₹150 | ₹125 |
  | Potato Starch (Native) | ₹50 | ₹60 |
  | Potato Starch (Waxy) | ₹60 | ₹95 |
  | Corn Fiber | ₹225 | ₹325 |
  | Pea Fiber | ₹325 | ₹380 |
  | Pea Fiber (Insoluble) | ₹325 | ₹185 |
  | Potato Dextrin | ₹275 | ₹375 |
  | Potato Fiber (Soluble) | ₹265 | ₹375 |
  | Rice Dextrin | ₹275 | ₹375 |
  | Rice Fiber (Soluble) | ₹275 | ₹375 |
  | Wheat Dextrin | ₹275 | ₹350 |
  | Wheat Fiber (Soluble) | ₹285 | ₹350 |
  | Fructo Oligosaccharides (FOS) | ₹300 | ₹250 |
  | Galacto Oligosaccharides Powder (GOS) | ₹1200 | ₹1000 |

- **Renamed to match the list (2):** the grade of Rice Fiber and of Wheat Fiber that was called "Standard" becomes "Soluble".
- **Same price, terms added (56):** MOQ 100 kg on every rate.
- **Not on the new list:** nothing. Every product that had a rate in September is on the November list.
- **Terms on every rate:** ex-factory; MOQ 100 kg; proteins and hydrolysed proteins 18% GST in 20 Kg packs; starches, modified starches, fibres, dextrins, flours and saccharides 5% GST in 25 Kg packs (Soya Flour "25/50 Kg").

**Questions**
1. **Lecithin GST (the one that matters).** Your message says only proteins are 18% and the rest 5%. The GST section of the same price list puts "Lecithin Derivatives – 25 Kg" under 18%. I kept the 13 lecithin rates at **18%**, as printed, and marked them "Confirm" so nobody quotes them unchecked. Which is right: 18% or 5%? (Soya Isoflavones sits under Lecithin and follows the same answer unless you say otherwise.)
2. **Pea Fiber (Insoluble) drops from ₹325 to ₹185** while every other fibre went up. Is ₹185 correct?
3. **"E1420 Acetylated Starch – 105 Rs/Kg (Default)":** read as the existing single grade at the same price. Say so if "(Default)" means something else.
4. Two places on the list have items typed without a line break ("Saccharides:Xylo…" and "…350 Rs/KgInulin Powder – 450"). They were read as separate items: XOS ₹700, IMO ₹350, Inulin ₹450.

**How it goes live**

1. **One database step (2 minutes, needed before the new version can deploy).** The Supabase access token in the agent environment has expired, so I could not do this for you. Open Supabase → **SQL Editor** → **New query**, paste the block below, press **Run**. It only adds two empty columns to the settings table; no data changes.

   ```sql
   begin;
   -- 0003_org_payment_terms
   ALTER TABLE "app"."org_settings" ADD COLUMN "payment_terms" text;
   insert into drizzle.__drizzle_migrations (hash, created_at) values ('884d595b1548f4308e2a4a16f4ca995b87fecbc7156e94893fc5b065c20c8f06', 1794875962737);
   -- 0004_org_price_list_map
   ALTER TABLE "app"."org_settings" ADD COLUMN "price_list_map" jsonb;
   insert into drizzle.__drizzle_migrations (hash, created_at) values ('f2730e67e6a660c6d470bed6e848824e101c6690c2dc7d914ecbdda8a4b2d31c', 1794894972300);
   commit;
   ```

   Then open Vercel → **Deployments** → the newest (failed) one → **Redeploy**. Until this is done Vercel shows new deployments as failed on purpose and the site keeps running on the previous version (`docs/SETUP.md` section 11).
2. **Settings → Organisation:** type `100% advance` in **Payment terms** and save.
3. **Rates → Import price list:**
   - Open **How Inquira reads your list (mapping)**, paste the whole text of [`seed/stdm/price-list-map.json`](seed/stdm/price-list-map.json) and press **Save mapping**.
   - Paste your price list, press **Show changes**, check that it shows what is listed above, press **Apply**. Old rates stay in the history.

## Q-016 — Licence (deferred by the owner, 17 Nov 2026)
- **Owner's answer:** no licence for now. Inquira is for the owner's own use and should run locally. Keep the open-source idea for later.
- **Effect:** no `LICENSE` file is added; G-OSS-1 waits. Without a licence the code stays "all rights reserved" even though the repository is public. When the owner wants to publish, the choice is between AGPL-3.0-or-later and MIT (not legal advice).

## Q-017 — Roles "QA" and "Accounts" (answered 18 Nov 2026)
- **Owner's answer:** make both, and let owners and admins give or take away any access per person.
- **Built as:** QA = view everything, add and remove documents. Accounts = view leads, quotations, prices and documents, no settings. Per-person changes on Settings → Members → Access. Adjust either default by saying so.

## Q-018 — Documents to upload
- **Question:** Please add your COA, TDS and MSDS files under **Documents**, with batch and expiry date. Which products have them?
- **Why:** quotations can attach them only after they are uploaded; an expired file is never attached.

## Q-019 — IndiaMART API: assumptions to confirm on the first live lead
- **What was built from:** IndiaMART's help pages for the Push and Pull APIs (read 18 Nov 2026).
- **Assumed:**
  1. The Pull API returns the same field names as the Push API (the Pull page shows its sample only as an image). The raw lead is stored, so nothing is lost if a name differs.
  2. Pull times are written `18-Nov-202609:30:00` (the page's examples; its text says `DD-MM-YYYY`).
  3. The push address is protected only by the random secret at its end (IndiaMART documents no signature; a "Unique CRM PUSH Key" appears only in a screenshot caption).
  4. The first load reads 30 days, not the full 365, so months-old leads do not appear as new. Say if you want more.
- **Please:** after connecting, open one IndiaMART lead in Inquira and compare it with the same lead in IndiaMART's Lead Manager.

## Q-020 — AI tiers: key, model and limits (18 Nov 2026)
- **Needed:** a Gemini API key from Google AI Studio for Basic AI (free tier is fine; Basic never receives personal data). Optional: a Claude API key for Advanced AI.
- **Model names are yours to choose** (Settings → AI). Inquira ships with none, so it never depends on a name that a provider retires. Pick a current model from the provider's list.
- **Assumed, please check once it runs:**
  1. Defaults: confidence 0.8; Basic 200 calls a day, Advanced 50. Set Basic at or below the free tier's daily limit shown in AI Studio.
  2. Leads older than 7 days are not sent to AI.
  3. The OpenAI-compatible adapter uses JSON mode (`response_format: json_object`); a provider without it will answer "bad request" on Test connection.
- **Please:** after a day, look at the dashboard's AI card and correct any wrong product or request type on the lead page; tell me if a tier is often wrong.


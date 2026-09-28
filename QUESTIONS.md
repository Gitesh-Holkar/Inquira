# Open questions for Gitesh

Each item lists the question, what I assumed so the build could continue, and where it matters in the code.

## Q-001 — Do rates include GST?
- **Question:** The rates file (`PRODUCT_PRICE_LIST.docx`) doesn't say whether prices include GST.
- **Assumed:** Prices **exclude** GST. STDM's own sent quotations quote the same numbers as "GST: 18% extra" / "5% GST extra". All 70 rates are imported with `gst_treatment = exclusive`.
- **Where it matters:**
  - `seed/rates.json` (`assumptions`)
  - `src/modules/catalog` (price entries)
  - the quote templates, which show "GST x% extra"
- **To change:** If this is wrong, update the rates in *Rates → Update rates*. History is kept.

## Q-002 — MOQ per product?
- **Question:** The rates file has no MOQ. Sent quotations usually say "MOQ: 100 kg".
- **Assumed:** `moq_kg` is left empty on every price entry, and the `{{moq}}` placeholder renders empty. I did not invent 100 kg.
- **Where it matters:** `price_entries.moq_kg` and the quote template.
- **To change:** Set it on the *Update rates* screen.

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

## Q-005 — Rates flagged `needs_confirmation`
1. **Spirulina Protein Powder "(White)":** what does "White" mean?
2. **Soya Isoflavones (₹1200):** it's listed under Lecithin (18%), but it isn't a lecithin. Confirm the GST % and pack size.
3. **"Oats Fiber - Oat Fiber Insoluble – 195":** imported as one Insoluble grade. Is there a separate Oats Fiber rate?
4. **Soya Flour (₹95):** is the pack size 25 kg or 50 kg?

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

## Q-012 — Inviting teammates
- **Question:** There's no members screen yet (SETUP §4 has the SQL). Should it be next on the roadmap?

## Q-013 — Scheduled resume
- **What happened:** The 04:10 IST resume is scheduled (trigger `trig_01MkFUSSb63XEULCu98HgQZQ`). The build finished before it fired, so that run will just re-check and exit.

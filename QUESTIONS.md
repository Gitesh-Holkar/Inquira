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

## Q-003 — Full product list from stdmfood.com
- **Question:** stdmfood.com is blocked by this build environment's network policy, so I couldn't scrape it. `seed/products.json` = the rates file (authoritative, with prices) + 7 product pages found via web search. That adds 1 product that isn't in the rates file: Carboxymethyl Starch (CMS), which has no price.
- **Assumed:** The rates file is the catalogue.
- **To do:** Once `stdmfood.com` is allowed, run `npm run seed:website` to diff the website catalogue against the database.

## Q-004 — Supabase connection from the build container
- **Question:** This cloud container can't reach `*.supabase.co` / `api.supabase.com`, and outbound Postgres TCP (5432/6543) is closed.
- **Assumed:** Everything is built and tested against a local Postgres 16. It uses a Supabase-compatible shim (`auth` schema, `authenticated`/`service_role` roles, `auth.uid()`).
- **To do:** Migrations and seed for the real project run via `npm run db:remote:apply`, which uses the Supabase Management API over HTTPS with `SUPABASE_ACCESS_TOKEN`, or via `npm run db:migrate` from your own machine. See `docs/SETUP.md`.

## Q-005 — Rates flagged `needs_confirmation`
1. **Spirulina Protein Powder "(White)":** what does "White" mean?
2. **Soya Isoflavones (₹1200):** it's listed under Lecithin (18%), but it isn't a lecithin. Confirm the GST % and pack size.
3. **"Oats Fiber - Oat Fiber Insoluble – 195":** imported as one Insoluble grade. Is there a separate Oats Fiber rate?
4. **Soya Flour (₹95):** is the pack size 25 kg or 50 kg?

## Q-006 — Salesperson name in notifications
- **Question:** IndiaMART and TradeIndia greet a named salesperson.
- **Assumed:** Parsers never depend on that name, and the connected mailbox address is read from the Gmail integration, never hard-coded.
- **Question for you:** Should drafts be addressed from a specific person?

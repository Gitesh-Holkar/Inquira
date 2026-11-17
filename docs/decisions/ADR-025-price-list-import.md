# ADR-025: Price lists are imported from their own text, through one code path

- **Status:** Accepted
- **Date:** 17 Nov 2026
- **Requirement:** GOAL G-KB-6, G-KB-2, P6

## Context

The first company sends its prices as a document: one item per line ("Pea Isolate Protein - 350 Rs/Kg") under headings, with a GST section at the end. In September the list was converted by hand into `seed/rates.json`. In November a new list arrived with 80 lines, new products, renamed lines and 14 price changes, and the owner stated the quotation terms (ex-factory, 100% advance, MOQ 100 kg, pack size and GST by category).

## Problem

How does a new price list become rate-book entries, so that the owner sees and confirms the changes first, nothing is guessed, old rates stay in history, and the same thing works for another company's list?

## Options

1. Convert each list by hand into a rates JSON file and reseed. Rejected: no diff, no history for an existing database, and the hand conversion is where mistakes hide.
2. A spreadsheet upload with fixed columns. Rejected for now: the company does not keep its prices that way; it would add a format nobody uses.
3. Read the list's own text. Keep the company's reading of it (which heading has which GST rate and pack size, which list name is which product and grade) as data. Show a diff; write only on confirmation.

## Decision

Option 3.

- `parsePriceList` reads the text and never drops or guesses a line; unreadable lines are reported.
- The company's mapping is data: `seed/<company>/price-list-map.json`, saved per company in `org_settings.price_list_map`. Prices are never in the mapping.
- `planImport` is pure and produces the diff. GST, pack size and MOQ come from the mapping, else the grade's current rate, else the product's own defaults. A line with no known GST rate is reported and not written.
- `applyPriceListImport` writes the diff in one transaction through the append-only rate book.
- Three entry points share this code: **Rates → Import price list** (paste, read the changes, apply), `npm run rates:import` (prints the diff; writes only with `--confirm`), and the seed (a new database gets its rates from the newest list in the seed folder).
- Payment terms are a company setting (`org_settings.payment_terms`) printed on every quotation; MOQ, pack size, GST and price basis stay on each rate.

## Reasoning

One code path means a seeded database and a later import cannot disagree; a test checks that every seed folder's own list shows nothing left to change. Keeping the raw line in each rate's note makes every number traceable to the document it came from. A product that is on the catalogue but missing from a list is kept and reported, because missing does not mean discontinued.

## Consequences

- `seed/rates.json` is gone; rates come from `seed/<company>/price-lists/*.txt`.
- A new product on a future list is created only if the mapping (or the catalogue) gives its GST rate; otherwise the owner adds it on the Rates screen first.
- The mapping is edited as text (JSON) in a folded section of the import screen, or loaded with the seed or `rates:import --map … --save-map`. A form for it is not built: it changes rarely and is prepared with the list. Lines that match the catalogue by name or alias need no mapping.
- Word documents are not read directly: the text is pasted.

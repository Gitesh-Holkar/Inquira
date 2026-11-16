# Roadmap

The end goal and every requirement ID are in [`docs/GOAL.md`](GOAL.md). This file only orders the work. Live status is in `PROGRESS.md`.

## Phases (from GOAL section 5)

A phase starts only when the previous gate is passed.

| Phase | Delivers | Gate to pass |
| --- | --- | --- |
| 0. Safe and documented | Sign-in always on; audit bugs fixed; documentation structure; open-source basics; local mode; new price list imported | All checks green; local mode verified from a clean clone; the owner has confirmed the price diff |
| 1. Every lead in one place | IndiaMART Push and Pull; first real Gmail and TradeIndia sync; reconciliation | One week where API and email counts agree within tolerance |
| 2. The brain | Understanding a lead; the AI layer; commercial terms, rate validity, document library, sample policy | The Basic tier identifies the product correctly on a labelled sample; no personal data leaves in Basic calls |
| 3. Assisted sending | Templates; outbound pipeline in `shadow`; follow-ups; reporting; members screen; backups | Two weeks of drafts that needed few edits; the founder approves; then `assisted` is switched on |
| 4. Conversations and WhatsApp API | Document replies in conversations; drafted wider replies; WhatsApp Cloud API | One month in `assisted` with no wrong automatic send |
| 5. Orders | Customer master, proforma invoices, ClearTax export, repeat orders | The owner supplies proforma samples and the ClearTax template |
| 6. Attendance, other companies | Attendance as its own project; sign-up and billing only if an outside company asks | — |

## Milestones

Each milestone is planned, built, tested and documented before the next one starts. **OWNER GATE** means work stops until the owner answers.

| # | Milestone | Phase | Requirements | Owner gate |
| --- | --- | --- | --- | --- |
| M0 | Safe and correct | 0 | G-PLT-1, G-SRC-3, G-SRC-4 | — |
| M1 | Open-source foundation | 0 | G-OSS-1 to G-OSS-4, P6 | Licence choice |
| M2 | Local mode | 0 | G-PLT-5, G-PLT-6 | — |
| M3 | New price list and import command | 0 | G-KB-6 | Confirm the diff before anything is written to a live database |
| M4 | IndiaMART API | 1 | G-SRC-1, G-SRC-2, G-SRC-6, G-SRC-7, G-SRC-8 | Register the Push URL; enter the Pull key |
| M5 | AI layer | 2 | G-AI-1 to G-AI-10, G-UND-3, G-UND-4 | Provide a Gemini key |
| M6 | Knowledge base | 2 | G-KB-2 to G-KB-5, G-UND-6 | Provide COA, TDS and brochure files |
| M7 | Outbound pipeline | 3 | G-TPL-*, G-OUT-1 to G-OUT-7, G-OUT-9, G-OUT-10 | Mode stays `shadow`; only the owner switches it |
| M8 | Operations | 3 | G-FUP-1, G-RPT-*, G-PLT-2, G-PLT-7 | — |

## Later: design seams only, nothing built yet

- WhatsApp Cloud API adapter and inbound messages (G-OUT-8).
- Conversation automation (G-CNV-2, G-CNV-3).
- Customer master, proforma invoices, ClearTax export, repeat orders (G-ORD-*).
- Attendance is a separate project (G-ATT-1).

## Not going to be built

See GOAL section 7 and the Rejected records in [`docs/decisions/`](decisions/README.md).

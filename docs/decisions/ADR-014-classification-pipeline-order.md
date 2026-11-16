# ADR-014 — Email classification order

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
Most mail in a sales mailbox is not an enquiry.

## Problem
In which order to apply the checks so nothing is dropped silently.

## Options
- Heuristics first.
- The team's own rules first, then portal parsers.

## Decision
Messages are checked in this order: our own mail; the team's rules; portal parsers (IndiaMART, TradeIndia); a thread already linked to a lead; OTP, bank and newsletter heuristics; otherwise `needs_review`. Direct email enquiries always go to review. International mail gets a hint, never an automatic drop.

## Reasoning
Code cannot extract product and quantity reliably from free text, and a wrong automatic ignore loses a customer.

## Consequences
The AI tiers (GOAL G-AI-6) are inserted before the review queue, not instead of the rules.

# ADR-034: Replied leads are hidden after some days, not erased

- **Status:** Accepted
- **Date:** 28 Nov 2026
- **Requirement:** owner's request of 28 Nov 2026 (Leads shows only the leads not replied yet; replied leads go after a week; a failed send must never lose a lead)

## Context

The owner wants the Leads screen to show only enquiries nobody has answered. Once a reply went out (by email automatically or by a person, and on WhatsApp), the lead should move to a "replied" list and disappear a week later. What happens after the reply (the customer relationship) is handled in WhatsApp and email, not in Inquira.

## Problem

When is a lead "replied", and what does "deleted after a week" do to the data, given that the same enquiry can arrive again (sync overlaps, a 30-day reload after reconnecting a portal) and the buyer may write back later?

## Options

1. **Erase the row after a week.** The next sync overlap or reload would import the enquiry again as a new unreplied lead; quotations, outbox messages, emails and the audit log would point at nothing; reports would change after the fact.
2. **Use the lead status** (New, Contacted, Quoted…) as replied/not replied. Statuses are set by people and by quote drafts, not by whether a message really went out, so a failed send could still look answered.
3. **A replied state computed from what really happened, and a soft delete with a reason.** Replied = a reply went out (`replied_at`), nothing for the lead waits or failed in the Outbox (`outbox_pending`), and the buyer has not written since (`last_buyer_message_at`). After the company's number of days the lead is soft-deleted with `deleted_reason = 'replied'`.

## Decision

Option 3. The days are a company setting (default 7; empty keeps them). A buyer message in the thread, or from the same contact, restores a lead removed this way; a lead a person deleted stays deleted. "Mark as replied" and deleting stop the lead's unsent messages. A reply a person sends from Gmail in the lead's thread counts and stops Inquira's unsent email for that lead.

## Reasoning

- A send that fails, or a message waiting in the Outbox, keeps the lead visible: nothing is lost by an error.
- The hidden row keeps de-duplication working (the same enquiry is matched and stays hidden), keeps reports and the audit trail right, and lets a returning buyer pick up where they left off.
- The state is derived from the Outbox and email, which code controls, rather than from a status a person may forget to change.

## Consequences

- WhatsApp counts as sent when a person opens it from Inquira; Inquira cannot see whether it was sent inside WhatsApp.
- Leads are not erased from the database. Erasing personal data on request needs a separate step (not built; nobody asked).
- On first deploy, leads already answered (by a sent message, a Gmail reply in their thread, or a status moved past New) more than 7 days ago leave the list at the next check.

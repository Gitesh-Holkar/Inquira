# Security policy

Inquira holds buyer contact details, prices and the keys to a company's mailbox, so security reports are taken seriously.

## Reporting a problem

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately on GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can read it.

If that button is not there, open a public issue that says only "Security report: please give me a private contact" with no details, and a maintainer will reply.

Please include:

- what an attacker could do, and what they need first (a signed-in account? which role?);
- the steps to show it, on your own copy (local mode is fine: `docs/SELF_HOSTING.md`);
- the version or commit you tested.

Never test against someone else's Inquira, and never use real buyer data or real keys in a report.

## What happens next

- We reply within 7 days to say the report arrived.
- We tell you whether we can reproduce it, and roughly when a fix will ship.
- The fix goes into `main` and `CHANGELOG.md`. We credit you there unless you ask us not to.
- Please wait for the fix before you publish anything about the problem.

## Supported versions

Only the latest commit on `main` gets fixes. Inquira has no numbered releases yet.

## In scope

- Getting into a company's data without signing in, or seeing another company's data.
- A role doing more than it is allowed (for example a sales member changing rates, or a viewer changing anything).
- Reading or using stored keys (Gmail, IndiaMART, TradeIndia, AI providers, Claude tokens).
- Sending an email or message that the sending rules should have held (`docs/decisions/ADR-032-outbound-pipeline.md`).
- Text in a buyer's email or enquiry that makes Inquira or a connected AI do something it should not (prompt injection).
- Cross-site scripting, request forgery, open redirects, weaknesses in the sign-in or Claude connector flows.

## Out of scope

- Problems that need someone's device, mailbox or hosting account to be compromised first.
- Rate limits being per server instance (known, `docs/SECURITY.md`).
- Missing security headers that do not lead to an attack.
- Reports produced only by an automated scanner, without steps that show a real problem.

## How Inquira is protected

The threat model and every control, with the tests that check them, are in [`docs/SECURITY.md`](docs/SECURITY.md).

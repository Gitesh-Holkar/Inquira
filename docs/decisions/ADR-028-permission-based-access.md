# ADR-028: Access is decided by permissions, with custom access per member

- **Status:** Accepted
- **Date:** 18 Nov 2026
- **Requirement:** GOAL G-PLT-2 (roles owner, admin, sales, QA, accounts, viewer)

## Context

The goal lists six roles; Inquira had four. The owner asked for QA and Accounts, and for owners and admins to be able to switch single abilities on or off for a person, for example to let a QA person change prices, and to take any access away again.

## Problem

Fixed roles cannot express "QA plus prices". Row-level security checked role names (`app.has_role`), so a permission given to one person in the app would still be refused by the database, or, the other way round, a permission taken away in the app would still be allowed by it.

## Options

1. More roles for each combination. Rejected: the number of roles grows with every exception.
2. Custom access in the app only, database rules unchanged. Rejected: the two would disagree, and the database is the last line of defence.
3. **Permissions everywhere.** Each role has default permissions; each member may have permissions added (`granted`) or taken away (`revoked`). The app and the database compute the same thing.

## Decision

Option 3. Permissions are grouped into abilities (`ABILITIES`), which are what the Members screen shows; every permission outside the always-on set belongs to exactly one ability. The database copy of the role defaults (`app.role_default`) is checked against the code by a test. Rules: owners always have everything; nobody changes their own access; only owners change the access of owners and admins; you can give or take away only abilities you have; a role change resets custom access.

## Reasoning

Owners can handle exceptions without new code. A single source (the code) with a parity test keeps the SQL honest. Abilities keep the screen short and avoid half-working states (an ability's permissions are switched together, and abilities that live on the Settings screen bring "See settings" with them).

## Consequences

- Changing a role's defaults means changing `ROLE_PERMISSIONS` and adding a migration that replaces `app.role_default`; the test fails until both match.
- Reading stays open to every member of a company (dashboard, leads, quotations, rates, documents, templates are always visible); settings can be hidden per person.
- The Claude connector's narrow permission set is unchanged.

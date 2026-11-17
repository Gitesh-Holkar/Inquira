# ADR-027: Documents and new sign-in accounts go through the server, with the service role key

- **Status:** Accepted
- **Date:** 17 Nov 2026
- **Requirement:** GOAL G-KB-4 (document library), G-PLT-2 (members screen), G-PLT-6 (adapters)

## Context

The owner asked for the members screen and the document library before local mode (M2). Both need something only Supabase's service role can do in cloud mode: create a sign-in account, and read and write files in the private bucket `documents` (migration 0002 created it without storage policies).

## Problem

How do signed-in people upload and download documents, and how does an owner add a teammate, without giving the browser any key and without SQL?

## Options

1. Browser talks to Supabase directly, with storage policies per company and the Auth invite email. Rejected: company-scoped storage policies duplicate the app's permissions, the invite email shares the built-in mailer's small hourly limit, and local mode would need a different browser path.
2. Signed download URLs handed to the browser. Possible later; a URL can be forwarded and stays valid for its lifetime.
3. **The server does it.** Upload through a server action, download through `GET /api/documents/[id]`, account creation through the Auth admin API, each behind the app's own session and permission checks. Adapters (`src/lib/accounts.ts`, `src/modules/documents/storage.ts`) have a Supabase and a local implementation.

## Decision

Option 3. `SUPABASE_SERVICE_ROLE_KEY` is now used at runtime on the server for these two adapters (and still by the seed). It is never sent to a browser, logged or stored. Files are at most 4 MB (the hosting platform's request limit), checked by their first bytes, never overwritten, always served as downloads with `nosniff`. New accounts are created confirmed and without a password; the person sets one with "Forgot password? / First time here?".

## Reasoning

One permission system (the app's) decides who sees what, in both cloud and local mode. The service role key was already in the hosting settings for the seed. Server-side checks are covered by the same tests as every other service.

## Consequences

- If the key is missing on the host, Members and Documents say so and hide the add buttons instead of failing.
- Files pass through the server, so very large files are not supported; 4 MB covers COA, TDS and MSDS PDFs.
- Local mode (M2) adds its own sign-in accounts implementation; file storage already has the disk implementation.

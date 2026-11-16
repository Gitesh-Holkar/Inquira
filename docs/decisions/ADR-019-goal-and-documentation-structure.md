# ADR-019 — `docs/GOAL.md` is the source of truth; documentation structure and `AGENTS.md`

- **Status:** Accepted
- **Date:** 16 Nov 2026

## Context
The project's goal widened in November 2026 (open source, local mode, IndiaMART API, AI tiers, sending). Knowledge was spread across a chat handover and several documents.

## Problem
Where the goal, the rules and the decisions live, so that any person or agent can continue the work from the repository alone.

## Options
- Keep extending `CLAUDE.md` and one decisions file.
- One goal file with requirement IDs, one tool-neutral rulebook, one file per decision, and an index of documents.

## Decision
`docs/GOAL.md` states the end goal; if another document disagrees, the goal wins and the other document is fixed. `AGENTS.md` is the single rulebook; `CLAUDE.md` only imports it with `@AGENTS.md`, which is the documented Claude Code import syntax. `docs/INDEX.md` lists every document and when to read it. Decisions are one file each in `docs/decisions/`. `CHANGELOG.md` records what users and operators would notice.

## Reasoning
Requirement IDs make plans and tests traceable. A tool-neutral rulebook works with any coding agent. Next.js writes its agent-rules block into `AGENTS.md` when that file hosts the block, so the block lives there.

## Consequences
`docs/DECISIONS.md` is now a pointer. `docs/REQUIREMENTS.md` is history. Documentation changes in the same commit as code (`AGENTS.md` section 7).

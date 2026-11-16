# ADR-013 — MCP authentication: OAuth 2.1 with client registration and PKCE, plus bearer tokens

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
claude.ai custom connectors need OAuth with Dynamic Client Registration, a `401` carrying `WWW-Authenticate: Bearer resource_metadata=…`, discovery documents, S256 PKCE and rotating refresh tokens.

## Problem
How Claude authenticates to Inquira's MCP server.

## Options
- Supabase Auth as the authorisation server (no client registration).
- Client ID metadata documents only (not advertised yet).
- Inquira as its own authorisation server.

## Decision
Inquira serves the discovery documents, `/api/oauth/register`, a consent screen at `/oauth/authorize` for a signed-in owner or admin, and `/api/oauth/token` with 1-hour access tokens and 30-day rotating refresh tokens. Manual bearer tokens also work. Every token is stored only as a SHA-256 hash. The transport is stateless Streamable HTTP with a fresh server per request.

## Reasoning
It works with claude.ai, Claude Code and the MCP Inspector, and suits serverless hosting.

## Consequences
The consent action depends on sign-in being on; see `docs/RUNBOOK.md` for revoking tokens.

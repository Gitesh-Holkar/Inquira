# ADR-016 — Hand-written shadcn-style components

- **Status:** Accepted
- **Date:** 29 Sep 2026

## Context
The shadcn CLI needs its registry host, which the build container could not reach.

## Problem
How to get consistent, accessible UI components.

## Options
- A full component library dependency.
- A small local set following shadcn's patterns.

## Decision
A small set of components in `src/components/ui` follows shadcn's patterns (Radix primitives, `cva`, `cn`, CSS-variable tokens). Design tokens are in `src/app/globals.css`.

## Reasoning
Few dependencies, full control over accessibility and tap-target sizes.

## Consequences
New components follow the same patterns.

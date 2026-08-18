# Project Context — The Living Canvas PMS

## What this is

The Living Canvas PMS is a multi-property hospitality Property Management
System (PMS) — a SaaS platform where hospitality companies (organizations)
manage one or more properties (hotels, guesthouses, boutique venues), each
with its own rooms/units and staff.

This is a **hospitality PMS** (rooms, staff, and — in later modules —
bookings/reservations), not a landlord–tenant leasing system.

## Planning vs. implementation

- **Claude Desktop** owns architecture, requirements, technical decisions,
  and task breakdown for this project.
- **This repository** (worked on via Claude Code in VS Code/WSL) is where
  that plan gets implemented. The project files and git history here are
  the source of truth for what has actually been built.

## Scope discipline

Build only what the current task in [TASKS.md](TASKS.md) calls for. Do not
get ahead of the plan into future modules such as bookings, OTA
integrations, reviews, payments, or marketing unless a task explicitly
requires it.

## Current foundational scope (this task)

- Organizations (tenants)
- Staff users (no authentication yet — that's a separate future task)
- Properties
- Rooms (operational status only — no booking/occupancy state yet)

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the schema and
[ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## How work gets implemented

Implementation work is carried out through a controlled multi-agent
system — specialist agents (Frontend, Backend, Database, QA, Security,
DevOps) coordinated by an Orchestrator, each with a defined file-scope
boundary. This is a process convention, not a product feature: it governs
how the codebase gets built, not what gets built. See
[AGENTS.md](AGENTS.md).

## Provenance note

This set of docs (PROJECT_CONTEXT.md, ARCHITECTURE.md, DATABASE_SCHEMA.md,
DECISIONS.md, TASKS.md) was bootstrapped directly in this repo on
2026-08-18 because the workspace was empty when implementation started —
no prior planning docs had been copied in from Claude Desktop yet. If a
separate, more authoritative planning doc set already exists elsewhere,
reconcile these files against it rather than treating this bootstrap as
final.

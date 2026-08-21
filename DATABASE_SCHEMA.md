# Database Schema — The Living Canvas PMS

Source of truth: [backend/prisma/schema.prisma](backend/prisma/schema.prisma).
This document is a human-readable summary — if it ever disagrees with the
Prisma schema, the schema wins; update this file to match.

## Scope

The foundational schema covers organizations, staff users, properties,
and rooms. Phase 1 (2026-08-19, see [DECISIONS.md](DECISIONS.md)) adds
the auth/tenancy/authorization layer on top of it: sessions, a permission
catalog, organization-scoped roles, and property-level access grants.
Both are still explicitly narrower than the full product — bookings,
reservations, OTA integration data, reviews, payments, and marketing
remain future modules with their own tasks.

## Entities

### Organization

A tenant of the platform — one hospitality company. Owns users and
properties.

| Column       | Type      | Notes                     |
|--------------|-----------|---------------------------|
| id           | uuid      | PK                        |
| name         | text      |                           |
| slug         | text      | unique                    |
| created_at   | timestamp |                           |
| updated_at   | timestamp |                           |

### User (staff)

A staff member who can operate the PMS on behalf of an Organization.
`role` is a coarse, UI-facing preset — the actual authorization decision
is made from resolved permissions via `UserRoleAssignment` → `Role` →
`RolePermission` (see below), not from this enum directly.

| Column              | Type       | Notes                                   |
|---------------------|------------|-------------------------------------------|
| id                  | uuid       | PK                                       |
| organization_id     | uuid       | FK → organizations, cascade delete       |
| email               | text       | unique                                   |
| password_hash       | text?      | nullable until a user completes signup   |
| first_name          | text       |                                           |
| last_name           | text       |                                           |
| role                | enum       | OWNER \| ADMIN \| MANAGER \| STAFF       |
| is_active           | boolean    | default true                             |
| tokens_valid_after  | timestamp? | token-revocation watermark — see below   |
| created_at          | timestamp  |                                           |
| updated_at          | timestamp  |                                           |

`tokens_valid_after` is the token-revocation watermark (added
2026-08-20, see [DECISIONS.md](DECISIONS.md)): `authenticate` rejects an
already-issued access token whose `iat` predates this value, even though
its own signature and expiry are still valid — closing the gap
`Session` revocation alone can't (an access token that was minted
*before* a user was deactivated and hasn't expired yet). Null (the
default, and the state of every user who has never been deactivated)
means "no floor" — nothing is rejected on this basis. Set via
`platform/auth/revocation.ts`'s `bumpTokensValidAfter`/`deactivateUser`,
never written directly elsewhere.

### Session

Backs the JWT access token (Phase 1 decision #1, see
[DECISIONS.md](DECISIONS.md)): the access token is short-lived and
stateless, but each refresh token has a real row here so a session can be
revoked immediately — e.g. staff offboarding — rather than waiting out an
expiry. Only a hash of the refresh token is stored, never the token
itself.

| Column             | Type      | Notes                               |
|--------------------|-----------|--------------------------------------|
| id                 | uuid      | PK                                   |
| user_id            | uuid      | FK → users, cascade delete           |
| refresh_token_hash | text      | unique                               |
| user_agent         | text?     |                                       |
| ip_address         | text?     |                                       |
| expires_at         | timestamp |                                       |
| revoked_at         | timestamp?| null while active                    |
| created_at         | timestamp |                                       |

### Permission

The global permission catalog (Phase 1 decision #2). Deliberately **not**
scoped under Organization — a key like `properties:update` is a
platform-defined capability, identical across every tenant, not a piece
of any one organization's business data. The source of truth for which
keys exist is `backend/src/platform/rbac/permissions.ts`; this table
exists so `RolePermission` has a real foreign key and a future admin UI
can list permissions without hardcoding them.

| Column      | Type      | Notes   |
|-------------|-----------|---------|
| id          | uuid      | PK      |
| key         | text      | unique, e.g. `"properties:update"` |
| description | text      |         |
| created_at  | timestamp |         |

### Role

An organization-scoped role. Every organization gets its own copy of the
four built-in presets (OWNER/ADMIN/MANAGER/STAFF, `is_system = true`)
seeded at organization-creation time, matching `User.role`'s enum
values — this is what lets a future custom-role builder extend the same
schema without a breaking migration, while Phase 1 itself only ever
creates the four system presets.

| Column          | Type      | Notes                              |
|-----------------|-----------|--------------------------------------|
| id              | uuid      | PK                                  |
| organization_id | uuid      | FK → organizations, cascade delete  |
| name            | text      | unique per organization             |
| is_system       | boolean   | default false                       |
| created_at      | timestamp |                                      |
| updated_at      | timestamp |                                      |

### RolePermission

Join table: which permissions a Role grants. Composite PK
(`role_id`, `permission_id`); both sides cascade delete.

### UserRoleAssignment

Join table: which roles a User holds, unique per (`user_id`, `role_id`).
Named `UserRoleAssignment` rather than `UserRole` because `UserRole` is
already the enum on `User.role`.

### PropertyAccess

Explicit grant of a User onto a Property. OWNER/ADMIN role-holders reach
every property in their organization implicitly (checked in application
code, not via a row here); MANAGER/STAFF need an explicit row per
property they may access. Absence of a row is the default (no access) —
this table only ever grants, never restricts. Unique per
(`user_id`, `property_id`).

### Property

A single physical venue belonging to an Organization.

| Column           | Type      | Notes                                   |
|------------------|-----------|------------------------------------------|
| id               | uuid      | PK                                       |
| organization_id  | uuid      | FK → organizations, cascade delete       |
| name             | text      |                                           |
| slug             | text      | unique per organization                  |
| timezone         | text      | default "UTC"                            |
| address_line1/2  | text?     |                                           |
| city, region     | text?     |                                           |
| postal_code      | text?     |                                           |
| country          | text?     |                                           |
| is_active        | boolean   | default true                             |
| created_at       | timestamp |                                           |
| updated_at       | timestamp |                                           |

### Room

A bookable unit within a Property. Models **operational** status only
(is this room in service?) — occupancy/booking state belongs to the future
bookings module, not here.

| Column       | Type      | Notes                                       |
|--------------|-----------|-----------------------------------------------|
| id           | uuid      | PK                                            |
| property_id  | uuid      | FK → properties, cascade delete               |
| name         | text      | unique per property (e.g. "101", "Suite A")   |
| room_type    | text      | **legacy** free-text category — still what the API reads/writes |
| room_type_id | uuid?     | FK → room_types, `SET NULL` on delete          |
| floor        | text?     |                                                |
| capacity     | int       | default 1                                     |
| status       | enum      | ACTIVE \| INACTIVE \| MAINTENANCE             |
| notes        | text?     |                                                |
| created_at   | timestamp |                                                |
| updated_at   | timestamp |                                                |

### RoomType

A category of room within a Property ("Deluxe King", "Standard Twin").
Scoped to a **single Property**, not to the Organization: two hotels in
the same group name and price their rooms independently, so a shared
catalogue would force one property's rename onto the other.

Like `Room`, it carries no `organization_id` of its own — tenancy reaches
it transitively through `property_id`, and
`src/platform/tenancy/scoped-prisma.ts` scopes it through that relation.

| Column      | Type      | Notes                                        |
|-------------|-----------|----------------------------------------------|
| id          | uuid      | PK                                           |
| property_id | uuid      | FK → properties, cascade delete              |
| name        | text      | unique per property                          |
| code        | text?     | short operational code ("DLXK"); unique per property when present |
| description | text?     |                                              |
| is_active   | boolean   | default true                                 |
| created_at  | timestamp |                                              |
| updated_at  | timestamp |                                              |

Deliberately thin: occupancy lives on `Room.capacity`, and a second copy
here with no code to reconcile the two would be a silent source-of-truth
conflict. Rate plans, availability and reservations attach to this model
in later slices — none of them exist yet.

**Transitional state.** `Room` currently carries *both* `room_type` (the
original free text, still what the rooms API accepts, searches and
audits) and `room_type_id` (the new FK, backfilled from it). The FK is
nullable because rooms created through the API before the RoomType API
slice lands have no type yet. The free-text column is dropped only once
the API and UI read the relation instead — see TASKS.md 2b/2c.

### AuditLog

Immutable record of a consequential action taken within an Organization.
Written by `src/platform/audit/recorder.ts` from inside the service that
performed the action — never by a route, a client, or a direct database
write. There is no update or delete path in application code; the only
deletion is the Organization cascade (tenant offboarding).

Deliberately generic rather than staff-specific: `entity_type` +
`entity_id` name the target polymorphically, so properties, units,
leases, maintenance, payments and AI-agent actions all reuse this table
without a schema change. `action` is a **namespaced string**
(`"staff.role_changed"`), not a database enum, so adding an action costs
a constant in `src/platform/audit/actions.ts` rather than a migration
against a table that only grows.

| Column          | Type      | Notes                                            |
|-----------------|-----------|--------------------------------------------------|
| id              | uuid      | PK                                               |
| organization_id | uuid      | FK → organizations, cascade delete               |
| actor_type      | enum      | USER \| SYSTEM \| AGENT (default USER)           |
| actor_user_id   | uuid?     | FK → users, **SET NULL** on delete               |
| actor_email     | text?     | captured at write time; survives account removal |
| action          | text      | `"<module>.<event>"` — see `audit/actions.ts`    |
| entity_type     | text      | `"staff"` today; other modules later             |
| entity_id       | text      | primary key of the record acted on               |
| metadata        | jsonb?    | action-specific detail; never credentials        |
| created_at      | timestamp |                                                  |

`actor_user_id` is `SET NULL` rather than cascade on purpose: an audit
trail that disappears along with the account it describes is not an audit
trail. `actor_email` is denormalized for the same reason — the row has to
stay meaningful on its own.

Indexes all lead with `organization_id` (`+ created_at`, `+ entity_type,
entity_id`, `+ actor_user_id`): no query reaches this table without a
tenant filter, so a tenant-first index is the one that gets used.

## Relationships

```
Organization 1──* User 1──* Session
Organization 1──* Property 1──* Room *──0..1 RoomType
Organization 1──* Property 1──* RoomType
Organization 1──* Property 1──* PropertyAccess *──1 User
Organization 1──* Role *──* Permission   (through RolePermission)
User *──* Role                            (through UserRoleAssignment)
Organization 1──* AuditLog *──0..1 User   (actor; SET NULL, not cascade)
```

All child rows cascade-delete with their parent (deleting an Organization
removes its Users, Properties, Rooms, Roles, and — transitively — every
Session/RolePermission/UserRoleAssignment/PropertyAccess row that hangs
off them, plus its AuditLog rows). `Permission` is the one model with no
path back to `Organization` — see its entry above for why that's an
intentional exception, not a tenancy gap.

`AuditLog.actor_user_id` is the one deliberate *non*-cascade: removing a
user nulls the actor reference instead of deleting their audit history,
which is why `actor_email` is captured on the row.

`Room.room_type_id` is the second: deleting a RoomType nulls the
reference rather than deleting the rooms that used it. Rooms are physical
and outlive a catalogue decision; `room_type` still holds the label.

## Migrations

Migrations live in `backend/prisma/migrations/`:

- `20260818130940_init` — the foundational schema (Organization, User,
  Property, Room).
- `20260819000000_phase1_auth_rbac_tenancy` — Session, Permission, Role,
  RolePermission, UserRoleAssignment, PropertyAccess.
- `20260819182224_token_revocation_watermark` — adds `User.tokensValidAfter`
  (see the User table above).
- `20260820201210_audit_log` — adds the `AuditActorType` enum and the
  `audit_logs` table with its three tenant-first indexes. Generated and
  applied with `prisma migrate dev` against a real PostgreSQL 16.15
  (`postgres:16-alpine`), then exercised by the audit test suite against
  that same database.
- `20260821174800_room_type` — adds the `room_types` table and the
  nullable `rooms.room_type_id` FK, plus a **data backfill**: one
  `room_types` row per distinct `(property_id, room_type)` pair, then
  every room pointed at its own. Strictly additive — no column is
  dropped, renamed or made NOT NULL, and `rooms.room_type` is read but
  never written, so the migration cannot lose data. Applied with
  `prisma migrate dev` against real PostgreSQL 16.15
  (`postgres:16-alpine`); verified afterwards that the 1069 existing
  rooms were byte-identical (same `md5` fingerprint of
  `id:room_type` across all rows), 900 types were created, all 1069
  rooms linked, and zero label/property mismatches.

The first two were generated via `prisma migrate diff` against the
schema file alone and verified against
[PGlite](https://pglite.dev/) (the real PostgreSQL engine compiled to
WASM) — no live Docker-backed Postgres was reachable in the sandbox that
authored either one at the time (see the 2026-08-19 entries in
[DECISIONS.md](DECISIONS.md)). **Docker access opened up partway through
Phase 1** — the third migration was generated and applied the normal way
(`prisma migrate dev`) against a real, native `postgres:16-alpine`, and a
full run confirmed the first two apply cleanly there as well, closing the
"WASM, not the real target engine" caveat those earlier entries flagged.

```bash
npm run db:migrate -w backend   # prisma migrate dev — applies all pending migrations
```

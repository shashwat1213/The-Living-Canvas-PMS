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

| Column           | Type      | Notes                                   |
|------------------|-----------|------------------------------------------|
| id               | uuid      | PK                                       |
| organization_id  | uuid      | FK → organizations, cascade delete       |
| email            | text      | unique                                   |
| password_hash    | text?     | nullable until a user completes signup   |
| first_name       | text      |                                           |
| last_name        | text      |                                           |
| role             | enum      | OWNER \| ADMIN \| MANAGER \| STAFF       |
| is_active        | boolean   | default true                             |
| created_at       | timestamp |                                           |
| updated_at       | timestamp |                                           |

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
| room_type    | text      | free-text category (e.g. "Deluxe King")       |
| floor        | text?     |                                                |
| capacity     | int       | default 1                                     |
| status       | enum      | ACTIVE \| INACTIVE \| MAINTENANCE             |
| notes        | text?     |                                                |
| created_at   | timestamp |                                                |
| updated_at   | timestamp |                                                |

## Relationships

```
Organization 1──* User 1──* Session
Organization 1──* Property 1──* Room
Organization 1──* Property 1──* PropertyAccess *──1 User
Organization 1──* Role *──* Permission   (through RolePermission)
User *──* Role                            (through UserRoleAssignment)
```

All child rows cascade-delete with their parent (deleting an Organization
removes its Users, Properties, Rooms, Roles, and — transitively — every
Session/RolePermission/UserRoleAssignment/PropertyAccess row that hangs
off them). `Permission` is the one model with no path back to
`Organization` — see its entry above for why that's an intentional
exception, not a tenancy gap.

## Migrations

Migrations live in `backend/prisma/migrations/`:

- `20260818130940_init` — the foundational schema (Organization, User,
  Property, Room).
- `20260819000000_phase1_auth_rbac_tenancy` — Session, Permission, Role,
  RolePermission, UserRoleAssignment, PropertyAccess.

Both were generated via `prisma migrate diff` against the schema file
alone — **no live Postgres instance has been reachable in the dev sandbox
that authored either one** (see [DECISIONS.md](DECISIONS.md) for both
entries). Neither has been applied to a real database yet. The next
person with Postgres access must run, in order:

```bash
npm run db:migrate -w backend   # prisma migrate dev — applies both migrations
```

and confirm both apply cleanly before this schema is considered verified
end-to-end. This is a standing follow-up, not a new one — the same gap
flagged for the foundation migration now also covers the Phase 1
migration.

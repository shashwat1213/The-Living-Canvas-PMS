# Database Schema — The Living Canvas PMS

Source of truth: [backend/prisma/schema.prisma](backend/prisma/schema.prisma).
This document is a human-readable summary — if it ever disagrees with the
Prisma schema, the schema wins; update this file to match.

## Scope

The foundational schema covers organizations, staff users, properties,
and rooms. Phase 1 (2026-08-19, see [DECISIONS.md](DECISIONS.md)) adds
the auth/tenancy/authorization layer on top of it: sessions, a permission
catalog, organization-scoped roles, and property-level access grants.

Phase 2 builds out the operational core on the same foundation: the
room-type catalogue, rate plans and per-date rates, guests, reservations
(with per-night price snapshots and check-in/out), guest folios with
charges and payments, the housekeeping board, and maintenance work orders.
Still future modules with their own tasks: OTA integration data, reviews,
reporting, and marketing.

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

A bookable unit within a Property. Carries **two independent status axes**:
`status` is its inventory/service state (is this room sellable?), while
`housekeeping_status` is its physical-cleanliness state (is it ready to hand
over the key?). They are deliberately separate — a DIRTY room is still
bookable; only `status` (INACTIVE/MAINTENANCE) removes a room from sellable
inventory. This mirrors every commercial PMS (Cloudbeds, Mews, Stayntouch).

| Column       | Type      | Notes                                       |
|--------------|-----------|-----------------------------------------------|
| id           | uuid      | PK                                            |
| property_id  | uuid      | FK → properties, cascade delete               |
| name         | text      | unique per property (e.g. "101", "Suite A")   |
| room_type_id | uuid      | **required** FK → room_types, `RESTRICT` on delete |
| floor        | text?     |                                                |
| capacity     | int       | default 1                                     |
| status       | enum      | ACTIVE \| INACTIVE \| MAINTENANCE             |
| housekeeping_status | enum | DIRTY \| CLEANING \| CLEAN \| INSPECTED; default INSPECTED |
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
conflict. Rate plans attach to this model (see `RatePlan` below);
availability and reservations follow in later slices.

**Catalogue-only.** Every `Room` references a `RoomType` at its own
property through the **required** `room_type_id` FK — the model Mews,
Cloudbeds and Stayntouch all use: rooms are assigned a type from a managed
catalogue, never free text. The original free-text `room_type` column was
backfilled into `room_types` and dropped (migrations
`20260902000100_rooms_backfill_types` then
`20260902000200_rooms_catalogue_only`). The FK is `ON DELETE RESTRICT`, so
a type still assigned to rooms cannot be deleted out from under them — the
database backstop for the 409 the room-types service returns proactively.

### RatePlan

A sellable rate for a `RoomType` — "Best Available Rate", "Non-Refundable",
"Advance Purchase". The model every commercial PMS uses (Mews, Cloudbeds,
Stayntouch): what a room type costs is not one number but a set of plans,
each with its own price-per-date and cancellation policy.

Scoped to a **RoomType** (transitively to Property, then Organization) — two
hotels in one group price independently. No `organization_id` of its own;
`src/platform/tenancy/scoped-prisma.ts` scopes it through
`room_type → property`.

| Column        | Type      | Notes                                             |
|---------------|-----------|---------------------------------------------------|
| id            | uuid      | PK                                                |
| room_type_id  | uuid      | FK → room_types, cascade delete                   |
| name          | text      | unique per room type                              |
| code          | text?     | short code ("BAR", "NR"); unique per room type when present |
| description   | text?     |                                                   |
| is_refundable | boolean   | default true — the one cancellation-policy bit every PMS models from day one |
| is_active     | boolean   | default true                                      |
| created_at    | timestamp |                                                   |
| updated_at    | timestamp |                                                   |

### RatePlanRate

The price of one `RatePlan` on one calendar date, in **INR minor units
(paise)**, integer — money is never a float, and INR-only per the
initial-release decision (no currency column). One row per `(plan, date)`:
this is the room-night pricing grid a revenue manager edits, and storing it
per-date rather than as a rule makes an arbitrary seasonal calendar
representable without a rules engine. **Absence of a row for a date means
"unpriced / not sellable that night"** — a booking treats it as unavailable,
not free.

| Column       | Type      | Notes                                       |
|--------------|-----------|---------------------------------------------|
| id           | uuid      | PK                                          |
| rate_plan_id | uuid      | FK → rate_plans, cascade delete             |
| date         | date      | stay night (date-only, UTC midnight); unique per plan |
| amount_minor | int       | price in paise (INR minor units)            |
| created_at   | timestamp |                                             |
| updated_at   | timestamp |                                             |

### Guest

A person who stays (or has booked to stay) at one of an Organization's
properties. Scoped to the **Organization**, not a single Property: the same
person can stay at several of the group's hotels and their history should
follow them. Deliberately thin for the booking core — a richer profile
(loyalty, preferences, documents, consent) attaches here later without
reshaping it.

| Column          | Type      | Notes                                     |
|-----------------|-----------|-------------------------------------------|
| id              | uuid      | PK                                        |
| organization_id | uuid      | FK → organizations, cascade delete        |
| first_name      | text      |                                           |
| last_name       | text      |                                           |
| email           | text?     | not globally unique; a `(org, email)` index guards duplicate profiles within one org (enforced in app code, not a DB constraint) |
| phone           | text?     |                                           |
| notes           | text?     |                                           |
| created_at      | timestamp |                                           |
| updated_at      | timestamp |                                           |

### Reservation

A booking: a guest, a room type, a rate plan, and a stay window — the central
transactional record everything downstream (folios, housekeeping) hangs off.
A reservation books a **room type**, not a specific room (the industry model);
`room_id` is assigned at or before check-in. Money is **snapshotted**:
`total_amount_minor` is the price agreed at booking, with the per-night
breakdown in `ReservationNight`, so a later repricing of the rate calendar
never silently re-prices a booking a guest already holds. `room_type_id`,
`rate_plan_id` and `guest_id` are `RESTRICT` on delete (the DB backstop for the
services' delete-guards); the `property` cascade is the deliberate exception.

| Column             | Type      | Notes                                    |
|--------------------|-----------|------------------------------------------|
| id                 | uuid      | PK                                       |
| property_id        | uuid      | FK → properties, cascade delete          |
| room_type_id       | uuid      | FK → room_types, `RESTRICT`              |
| rate_plan_id       | uuid      | FK → rate_plans, `RESTRICT`              |
| guest_id           | uuid      | FK → guests, `RESTRICT`                  |
| room_id            | uuid?     | FK → rooms, `SET NULL`; null until assigned |
| reference          | text      | human booking ref (e.g. "LC-3F9K2A"), unique per property |
| status             | enum      | CONFIRMED \| CHECKED_IN \| CHECKED_OUT \| CANCELLED \| NO_SHOW; default CONFIRMED |
| check_in           | date      | arrival (date-only), inclusive           |
| check_out          | date      | departure (date-only), exclusive — nights = check_out − check_in |
| adults             | int       | default 1                                |
| children           | int       | default 0                                |
| total_amount_minor | int       | price agreed at booking, INR paise (sum of nights) |
| notes              | text?     |                                          |
| cancelled_at       | timestamp?| set when it leaves the active state      |
| cancel_reason      | text?     |                                          |
| created_at         | timestamp |                                          |
| updated_at         | timestamp |                                          |

A composite index on `(property_id, room_type_id, check_in, check_out)` backs
the overlap query availability and booking run.

### ReservationNight

One night of a reservation, with the price locked in at booking time — the
snapshot that makes `Reservation.total_amount_minor` trustworthy, what a folio
bills from, and what a nightly revenue report sums. One row per night in
`[check_in, check_out)`.

| Column         | Type      | Notes                                      |
|----------------|-----------|--------------------------------------------|
| id             | uuid      | PK                                         |
| reservation_id | uuid      | FK → reservations, cascade delete          |
| date           | date      | stay night (date-only); unique per reservation |
| amount_minor   | int       | price for this night in INR paise, as agreed at booking |
| created_at     | timestamp |                                            |

### Folio

The guest bill for a reservation — **one folio per booking (1:1)**. The running
account of what the guest owes (charges) against what they have paid
(payments). The balance is **derived** (charges − payments), never stored, so
it cannot drift from the rows that justify it. INR paise throughout, no
currency column. Tenancy reaches it through `reservation → property`; deleting
a reservation cascades its folio, charges and payments.

| Column         | Type      | Notes                                      |
|----------------|-----------|--------------------------------------------|
| id             | uuid      | PK                                         |
| reservation_id | uuid      | **unique** FK → reservations, cascade delete (1:1) |
| status         | enum      | OPEN \| CLOSED; default OPEN                |
| closed_at      | timestamp?| set when settled and closed (balance zero) |
| created_at     | timestamp |                                            |
| updated_at     | timestamp |                                            |

### FolioCharge

A single line item on a folio — a room charge auto-posted from the
reservation's nightly total when the folio opens, or a manually added extra
(minibar, late checkout, damage). The ledger is **append-only**: a correction
is a separate negative line, not an edit.

| Column      | Type      | Notes                                         |
|-------------|-----------|-----------------------------------------------|
| id          | uuid      | PK                                            |
| folio_id    | uuid      | FK → folios, cascade delete                   |
| description | text      |                                               |
| amount_minor| int       | INR paise; positive owes the guest, negative is a correction/discount |
| created_at  | timestamp |                                               |

### Payment

A payment (or, negative, a refund) recorded against a folio. **Manual entry
only** — the front desk records that a payment was taken; it is NOT a gateway
integration and holds no gateway credentials. The optional `reference` is a
free-text external id (card auth code, UPI txn id), never a stored credential.
Append-only: a refund is a separate negative row.

| Column      | Type      | Notes                                         |
|-------------|-----------|-----------------------------------------------|
| id          | uuid      | PK                                            |
| folio_id    | uuid      | FK → folios, cascade delete                   |
| method      | enum      | CASH \| CARD \| UPI \| BANK_TRANSFER \| OTHER |
| amount_minor| int       | amount received in INR paise (positive); a refund is negative |
| reference   | text?     | free-text external id; never a credential     |
| note        | text?     |                                               |
| created_at  | timestamp |                                               |

### HousekeepingTask

A unit of housekeeping work on a room — the task board a supervisor runs the
day from. Created automatically when a departure leaves a room to be turned
over (the check-out flow in `modules/reservations/service.ts` marks the room
DIRTY and opens a DEPARTURE task), or manually for a stayover / deep clean.
Tenancy reaches it transitively through `room → property → organization_id`;
there is no `organization_id` column of its own, and
`src/platform/tenancy/scoped-prisma.ts` scopes it through the `room` relation.

| Column         | Type      | Notes                                       |
|----------------|-----------|---------------------------------------------|
| id             | uuid      | PK                                          |
| room_id        | uuid      | FK → rooms, cascade delete                  |
| type           | enum      | DEPARTURE \| STAYOVER \| TURNDOWN \| OTHER; default DEPARTURE |
| status         | enum      | PENDING \| IN_PROGRESS \| DONE \| CANCELLED; default PENDING |
| assigned_to_id | uuid?     | FK → users, `SET NULL` on delete (history survives) |
| notes          | text?     |                                             |
| completed_at   | timestamp?| set when status moves to DONE, cleared on reopen |
| created_at     | timestamp |                                             |
| updated_at     | timestamp |                                             |

### MaintenanceWorkOrder

An engineering work order. Unlike a housekeeping task (which never affects
inventory), a work order MAY take a room **out of service**:
`takes_room_out_of_service` records whether opening it flipped the room's
`status` to MAINTENANCE, so resolving/cancelling it returns the room to ACTIVE
— but only if no other open order still holds the room out. `room_id` is
**optional**: property-level work (lobby, plant, grounds) has no room. Tenancy
is a direct `property_id` (scoped through Property, like Reservation).

| Column                    | Type      | Notes                               |
|---------------------------|-----------|-------------------------------------|
| id                        | uuid      | PK                                  |
| property_id               | uuid      | FK → properties, cascade delete     |
| room_id                   | uuid?     | FK → rooms, `SET NULL`; null = property-level |
| title                     | text      |                                     |
| description               | text?     |                                     |
| category                  | enum      | HVAC \| PLUMBING \| ELECTRICAL \| APPLIANCE \| FURNITURE \| STRUCTURAL \| SAFETY \| OTHER; default OTHER |
| priority                  | enum      | LOW \| MEDIUM \| HIGH \| URGENT; default MEDIUM |
| status                    | enum      | OPEN \| IN_PROGRESS \| RESOLVED \| CANCELLED; default OPEN |
| assigned_to_id            | uuid?     | FK → users, `SET NULL` on delete    |
| takes_room_out_of_service | boolean   | default false; true only with a room |
| resolved_at               | timestamp?| set when status moves to RESOLVED   |
| created_at                | timestamp |                                     |
| updated_at                | timestamp |                                     |

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
Organization 1──* Property 1──* Room *──1 RoomType
Organization 1──* Property 1──* RoomType 1──* RatePlan 1──* RatePlanRate
Organization 1──* Property 1──* PropertyAccess *──1 User
Organization 1──* Role *──* Permission   (through RolePermission)
User *──* Role                            (through UserRoleAssignment)
Organization 1──* Guest 1──* Reservation
Property 1──* Reservation *──1 RoomType, *──1 RatePlan, *──0..1 Room
Reservation 1──* ReservationNight
Reservation 1──0..1 Folio 1──* FolioCharge, 1──* Payment
Room 1──* HousekeepingTask *──0..1 User   (assignee; SET NULL)
Property 1──* MaintenanceWorkOrder *──0..1 Room, *──0..1 User (assignee; SET NULL)
Organization 1──* AuditLog *──0..1 User   (actor; SET NULL, not cascade)
```

All child rows cascade-delete with their parent (deleting an Organization
removes its Users, Properties, Rooms, Roles, Guests, Reservations, and —
transitively — every Session/RolePermission/UserRoleAssignment/PropertyAccess,
ReservationNight, Folio/FolioCharge/Payment, HousekeepingTask and
MaintenanceWorkOrder row that hangs off them, plus its AuditLog rows).
`Permission` is the one model with no path back to `Organization` — see its
entry above for why that's an intentional exception, not a tenancy gap.

`AuditLog.actor_user_id` is the one deliberate *non*-cascade: removing a
user nulls the actor reference instead of deleting their audit history,
which is why `actor_email` is captured on the row. The `assigned_to_id` on
HousekeepingTask and MaintenanceWorkOrder, and `Reservation.room_id` /
MaintenanceWorkOrder.room_id, are `SET NULL` for the same reason — work and
booking history survive the deletion of the staff member or room they named.

`Room.room_type_id`, plus `Reservation.{room_type_id, rate_plan_id, guest_id}`,
go the other way — `ON DELETE RESTRICT`: a RoomType still assigned to rooms
cannot be deleted, because a room must always have a type; likewise a room
type, rate plan or guest a reservation refers to cannot vanish out from under
it. Retire the type (`is_active = false`) instead; the rooms keep their
classification.

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
  (then nullable) `rooms.room_type_id` FK, plus a **data backfill**: one
  `room_types` row per distinct `(property_id, room_type)` pair, then
  every room pointed at its own. Strictly additive at the time — no column
  dropped, renamed or made NOT NULL. Applied with `prisma migrate dev`
  against real PostgreSQL 16.15 (`postgres:16-alpine`); verified afterwards
  that the existing rooms were byte-identical, one type per distinct pair
  was created, every room linked, and zero label/property mismatches.
- `20260902000100_rooms_backfill_types` — **safe / non-destructive** first
  half of the catalogue-only transition. Creates a `room_types` row for
  any `(property, label)` pair that still had unlinked rooms and no
  matching type, links every remaining orphan, and relaxes the legacy
  `rooms.room_type` NOT NULL so catalogue-only writes succeed while the
  column still exists. Deterministic: a room's type is its own label at
  its own property — nothing invented or merged across casing. Applied and
  verified against real PostgreSQL 16 (501 orphans → 0).
- `20260902000200_rooms_catalogue_only` — **destructive / irreversible**
  second half. Sets `rooms.room_type_id` NOT NULL, switches its FK from
  `SET NULL` to `RESTRICT`, and drops the legacy `rooms.room_type` column.
  Preconditioned on the backfill above (every room linked) and applied
  separately after it was verified, with explicit human approval for the
  destructive step. The label text survives on the linked `room_types`
  row, which is the point.
- `20260904103803_rate_plans` — **additive**. Adds `rate_plans` (per room
  type) and `rate_plan_rates` (per plan, per date; INR paise). No change to
  any existing table. Applied and verified against real PostgreSQL 16.
- `20260904113021_reservations` — **additive**. Adds the `ReservationStatus`
  enum, the `guests`, `reservations` and `reservation_nights` tables, and the
  `rooms.room_id` booking relation, with the composite overlap index that backs
  availability. No existing table altered destructively. Applied and verified
  against real PostgreSQL 16.
- `20260907044128_folios_payments` — **additive**. Adds the `FolioStatus` and
  `PaymentMethod` enums and the `folios` (1:1 with a reservation), `folio_charges`
  and `payments` tables. No existing table touched. Applied and verified against
  real PostgreSQL 16.
- `20260907115046_housekeeping` — **additive / non-destructive**. Adds the
  `HousekeepingStatus`, `HousekeepingTaskStatus` and `HousekeepingTaskType`
  enums, a `rooms.housekeeping_status` column (NOT NULL, default `INSPECTED`
  — no backfill needed, every existing room becomes ready), and the
  `housekeeping_tasks` table (FK → rooms cascade, FK → users set-null, indexed
  on room/assignee/status). No existing column dropped, renamed or made
  NOT NULL. Applied and verified against real PostgreSQL 16 (`prisma migrate
  dev`), then exercised by the housekeeping test suite and a live e2e probe.
- `20260907121848_maintenance_work_orders` — **additive / non-destructive**.
  Adds the `WorkOrderStatus`, `WorkOrderPriority` and `WorkOrderCategory`
  enums and the `maintenance_work_orders` table (FK → properties cascade,
  FK → rooms set-null, FK → users set-null, indexed on property/room/assignee/
  status). No existing table touched. Applied and verified against real
  PostgreSQL 16 (`prisma migrate dev`), then exercised by the maintenance test
  suite and a live e2e probe (including the room out-of-service/return flow).

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

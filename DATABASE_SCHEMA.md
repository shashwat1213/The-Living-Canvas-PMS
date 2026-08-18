# Database Schema — The Living Canvas PMS

Source of truth: [backend/prisma/schema.prisma](backend/prisma/schema.prisma).
This document is a human-readable summary — if it ever disagrees with the
Prisma schema, the schema wins; update this file to match.

## Scope

This is the **foundational** schema: organizations, staff users,
properties, and rooms. It intentionally excludes bookings, reservations,
OTA integration data, reviews, payments, and marketing — those are future
modules with their own tasks.

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
**No authentication is implemented yet** — `password_hash` is nullable and
unused until a future auth task wires up login.

| Column           | Type      | Notes                                   |
|------------------|-----------|------------------------------------------|
| id               | uuid      | PK                                       |
| organization_id  | uuid      | FK → organizations, cascade delete       |
| email            | text      | unique                                   |
| password_hash    | text?     | nullable — reserved for future auth task |
| first_name       | text      |                                           |
| last_name        | text      |                                           |
| role             | enum      | OWNER \| ADMIN \| MANAGER \| STAFF       |
| is_active        | boolean   | default true                             |
| created_at       | timestamp |                                           |
| updated_at       | timestamp |                                           |

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
Organization 1──* User
Organization 1──* Property 1──* Room
```

All child rows cascade-delete with their parent (deleting an Organization
removes its Users, Properties, and (transitively) Rooms).

## Migrations

Migrations live in `backend/prisma/migrations/`. The initial migration was
generated from an empty database via `prisma migrate diff` (no live
Postgres instance was available in the dev sandbox that authored it) and
has **not** been applied to a real database yet. Apply it against your own
Postgres instance with:

```bash
npm run db:migrate -w backend   # prisma migrate dev
```

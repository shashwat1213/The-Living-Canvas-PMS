-- Rooms → catalogue-only, step 1 of 2: SAFE / non-destructive backfill.
--
-- Every room must reference a RoomType (the model Mews/Cloudbeds/Stayntouch
-- all use). Rooms created through the legacy free-text path have a
-- `room_type` label but no `room_type_id`. This migration guarantees every
-- room is linked, WITHOUT dropping anything or tightening any constraint —
-- the destructive half (SET NOT NULL + DROP COLUMN) is migration
-- `20260902000200_rooms_catalogue_only`, applied separately after this one
-- is verified.
--
-- Deterministic: a room's type is its own free-text label at its own
-- property. No label is invented, guessed, or merged across the casing
-- boundary — "Suite" and "suite" stay distinct rows, exactly as the
-- @@unique([property_id, name]) constraint already treats them.

-- 1. Create the RoomType for any (property, label) pair that still has
--    unlinked rooms and no matching catalogue entry yet.
INSERT INTO "room_types" ("id", "property_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), pairs."property_id", pairs."room_type", true, now(), now()
FROM (
  SELECT DISTINCT "property_id", "room_type"
  FROM "rooms"
  WHERE "room_type_id" IS NULL
) AS pairs
WHERE NOT EXISTS (
  SELECT 1 FROM "room_types" rt
  WHERE rt."property_id" = pairs."property_id"
    AND rt."name" = pairs."room_type"
);

-- 2. Link every unlinked room to its property's matching type.
UPDATE "rooms" r
SET "room_type_id" = rt."id"
FROM "room_types" rt
WHERE r."room_type_id" IS NULL
  AND rt."property_id" = r."property_id"
  AND rt."name" = r."room_type";

-- 3. Relax the legacy column's NOT NULL so catalogue-only writes (which no
--    longer send a free-text label) succeed while the column still exists.
--    The column is dropped entirely in the next migration.
ALTER TABLE "rooms" ALTER COLUMN "room_type" DROP NOT NULL;

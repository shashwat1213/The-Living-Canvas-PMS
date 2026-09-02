-- Rooms → catalogue-only, step 2 of 2: DESTRUCTIVE / irreversible.
--
-- Preconditions (guaranteed by 20260902000100_rooms_backfill_types, which
-- MUST have been applied and verified first):
--   * every row in "rooms" has a non-null "room_type_id"
--   * "room_type_id" values all reference a real "room_types" row
--
-- This migration makes the relationship mandatory at the database level and
-- removes the legacy free-text column for good. There is no down migration:
-- the "room_type" label text is not recoverable once dropped (the name
-- survives on the linked "room_types" row, which is the point).

-- 1. The link is now required.
ALTER TABLE "rooms" ALTER COLUMN "room_type_id" SET NOT NULL;

-- 2. A room type still assigned to rooms must not be deletable out from
--    under them: switch the FK from ON DELETE SET NULL to ON DELETE
--    RESTRICT. This is the database backstop for the 409 the room-types
--    service already returns proactively.
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_room_type_id_fkey";
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_fkey"
  FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Drop the legacy free-text category. Nothing reads it any more — the
--    rooms API accepts, searches, audits and returns the structured type.
ALTER TABLE "rooms" DROP COLUMN "room_type";

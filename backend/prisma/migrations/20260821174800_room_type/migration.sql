-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "room_type_id" TEXT;

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_types_property_id_idx" ON "room_types"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_property_id_name_key" ON "room_types"("property_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_property_id_code_key" ON "room_types"("property_id", "code");

-- CreateIndex
CREATE INDEX "rooms_room_type_id_idx" ON "rooms"("room_type_id");

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: promote the existing free-text `rooms.room_type` values into
-- real `room_types` rows, one per distinct (property, label) pair, then
-- point each room at its own.
--
-- Non-destructive by construction: `rooms.room_type` is read, never
-- written, and `rooms.room_type_id` is a new nullable column. If this
-- backfill were removed entirely the migration would still apply
-- cleanly, leaving every existing room exactly as it was.
--
-- Matching is exact rather than case- or whitespace-normalized. Verified
-- against the live data before writing this: 1069 rooms, 900 distinct
-- (property_id, room_type) pairs, zero null-or-blank labels, and zero
-- pairs differing only by case or surrounding whitespace. Normalizing
-- would therefore change nothing here while silently merging two
-- genuinely distinct labels on some future database.
--
-- `gen_random_uuid()` is built into PostgreSQL 13+ (this project targets
-- 16) so no extension is required. `updated_at` is supplied explicitly
-- because Prisma's `@updatedAt` is applied in the client, not by a
-- database default.
INSERT INTO "room_types" ("id", "property_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), d."property_id", d."room_type", true, now(), now()
FROM (SELECT DISTINCT "property_id", "room_type" FROM "rooms") AS d
ON CONFLICT ("property_id", "name") DO NOTHING;

UPDATE "rooms" r
SET "room_type_id" = rt."id"
FROM "room_types" rt
WHERE rt."property_id" = r."property_id"
  AND rt."name" = r."room_type"
  AND r."room_type_id" IS NULL;

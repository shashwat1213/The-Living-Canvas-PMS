-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "group_id" TEXT;

-- CreateTable
CREATE TABLE "reservation_groups" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "contact_guest_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_groups_property_id_idx" ON "reservation_groups"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_groups_property_id_reference_key" ON "reservation_groups"("property_id", "reference");

-- CreateIndex
CREATE INDEX "reservations_group_id_idx" ON "reservations"("group_id");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "reservation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_groups" ADD CONSTRAINT "reservation_groups_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_groups" ADD CONSTRAINT "reservation_groups_contact_guest_id_fkey" FOREIGN KEY ("contact_guest_id") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

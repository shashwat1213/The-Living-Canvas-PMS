-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "kind" "MediaAssetKind" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "description" TEXT,
    "album" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "source_asset_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_property_id_created_at_idx" ON "media_assets"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_property_id_album_idx" ON "media_assets"("property_id", "album");

-- CreateIndex
CREATE INDEX "media_assets_property_id_kind_status_idx" ON "media_assets"("property_id", "kind", "status");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security: same property-anchored policy as marketing_content
-- (see 20261020120000_row_level_security).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "media_assets" TO lc_app;
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "media_assets" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

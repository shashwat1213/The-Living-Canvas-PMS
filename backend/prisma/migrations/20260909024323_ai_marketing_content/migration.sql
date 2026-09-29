-- CreateEnum
CREATE TYPE "MarketingContentFormat" AS ENUM ('SOCIAL_POST', 'EMAIL', 'PROMO_DESCRIPTION', 'TAGLINE');

-- CreateEnum
CREATE TYPE "MarketingContentStatus" AS ENUM ('GENERATING', 'DRAFT', 'APPROVED', 'DISCARDED', 'FAILED');

-- CreateTable
CREATE TABLE "marketing_content" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "format" "MarketingContentFormat" NOT NULL,
    "status" "MarketingContentStatus" NOT NULL DEFAULT 'GENERATING',
    "tone" TEXT,
    "brief" TEXT NOT NULL,
    "title" TEXT,
    "generated_body" TEXT,
    "edited_body" TEXT,
    "provider" TEXT,
    "last_error" TEXT,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_content_property_id_created_at_idx" ON "marketing_content"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_content_property_id_status_idx" ON "marketing_content"("property_id", "status");

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

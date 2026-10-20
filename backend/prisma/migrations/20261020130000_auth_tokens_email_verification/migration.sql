-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing users predate verification: treat them as verified so nobody
-- already using the product suddenly sees an "unverified" banner.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;

-- Row Level Security (see 20261020120000_row_level_security).
ALTER TABLE "auth_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "auth_tokens" TO lc_app
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = user_id));

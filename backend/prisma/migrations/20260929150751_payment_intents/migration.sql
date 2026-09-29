-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payment_intent_id" TEXT;

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "folio_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL,
    "gateway_order_id" TEXT,
    "gateway_payment_id" TEXT,
    "last_error" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_intents_folio_id_created_at_idx" ON "payment_intents"("folio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_intent_id_key" ON "payments"("payment_intent_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


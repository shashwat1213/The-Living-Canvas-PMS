-- CreateTable
CREATE TABLE "rate_plans" (
    "id" TEXT NOT NULL,
    "room_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "is_refundable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plan_rates" (
    "id" TEXT NOT NULL,
    "rate_plan_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_plan_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_plans_room_type_id_idx" ON "rate_plans"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_room_type_id_name_key" ON "rate_plans"("room_type_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_room_type_id_code_key" ON "rate_plans"("room_type_id", "code");

-- CreateIndex
CREATE INDEX "rate_plan_rates_rate_plan_id_date_idx" ON "rate_plan_rates"("rate_plan_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plan_rates_rate_plan_id_date_key" ON "rate_plan_rates"("rate_plan_id", "date");

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plan_rates" ADD CONSTRAINT "rate_plan_rates_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

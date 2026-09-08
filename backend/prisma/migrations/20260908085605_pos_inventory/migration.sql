-- CreateEnum
CREATE TYPE "PosOutletType" AS ENUM ('RESTAURANT', 'BAR', 'CAFE', 'SPA', 'MINIBAR', 'GIFT_SHOP', 'ROOM_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('OPEN', 'CHARGED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PosSettlement" AS ENUM ('UNSETTLED', 'ROOM_CHARGE', 'DIRECT');

-- CreateTable
CREATE TABLE "pos_outlets" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PosOutletType" NOT NULL DEFAULT 'OTHER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_products" (
    "id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "price_minor" INTEGER NOT NULL,
    "track_stock" BOOLEAN NOT NULL DEFAULT false,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_orders" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "settlement" "PosSettlement" NOT NULL DEFAULT 'UNSETTLED',
    "reservation_id" TEXT,
    "folio_charge_id" TEXT,
    "payment_method" "PaymentMethod",
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "line_total_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_outlets_property_id_idx" ON "pos_outlets"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_outlets_property_id_name_key" ON "pos_outlets"("property_id", "name");

-- CreateIndex
CREATE INDEX "pos_products_outlet_id_idx" ON "pos_products"("outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_products_outlet_id_name_key" ON "pos_products"("outlet_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pos_products_outlet_id_sku_key" ON "pos_products"("outlet_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_folio_charge_id_key" ON "pos_orders"("folio_charge_id");

-- CreateIndex
CREATE INDEX "pos_orders_property_id_idx" ON "pos_orders"("property_id");

-- CreateIndex
CREATE INDEX "pos_orders_outlet_id_idx" ON "pos_orders"("outlet_id");

-- CreateIndex
CREATE INDEX "pos_orders_reservation_id_idx" ON "pos_orders"("reservation_id");

-- CreateIndex
CREATE INDEX "pos_orders_status_idx" ON "pos_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_property_id_reference_key" ON "pos_orders"("property_id", "reference");

-- CreateIndex
CREATE INDEX "pos_order_items_order_id_idx" ON "pos_order_items"("order_id");

-- CreateIndex
CREATE INDEX "pos_order_items_product_id_idx" ON "pos_order_items"("product_id");

-- AddForeignKey
ALTER TABLE "pos_outlets" ADD CONSTRAINT "pos_outlets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "pos_outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_folio_charge_id_fkey" FOREIGN KEY ("folio_charge_id") REFERENCES "folio_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pos_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pos_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

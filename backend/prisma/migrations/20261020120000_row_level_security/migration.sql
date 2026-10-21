-- Postgres Row Level Security: the database-level tenant boundary.
--
-- Defence in depth under the app-layer scoping extension (scoped-prisma.ts).
-- Every query issued through `scopedPrisma` runs inside a transaction that
-- does `SET LOCAL ROLE lc_app` + `app.org_id = <caller's org>` (see
-- platform/tenancy/rls.ts). `lc_app` is a NOLOGIN role without BYPASSRLS, so
-- even a buggy where-clause or a raw SQL query on the scoped client cannot
-- read or write another organization's rows.
--
-- System paths that legitimately span tenants (login by email, signup,
-- refresh, the job worker's claim query, the public booking engine's slug
-- lookup, migrations) use the base client as the table owner, which RLS
-- does not apply to (no FORCE). That set is small, reviewed, and listed in
-- DECISIONS.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lc_app') THEN
    CREATE ROLE lc_app NOLOGIN;
  END IF;
END
$$;

GRANT lc_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO lc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lc_app;
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM lc_app;
  END IF;
END
$$;

-- Current tenant for this transaction; NULL (=> no rows) when unset.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS text
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULLIF(current_setting('app.org_id', true), '') $fn$;

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "folio_charges" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "folio_charges" TO lc_app
  USING (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id))
  WITH CHECK (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id));

ALTER TABLE "folios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "folios" TO lc_app
  USING (EXISTS (SELECT 1 FROM reservations r WHERE r.id = reservation_id))
  WITH CHECK (EXISTS (SELECT 1 FROM reservations r WHERE r.id = reservation_id));

ALTER TABLE "guests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "guests" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "housekeeping_tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "housekeeping_tasks" TO lc_app
  USING (EXISTS (SELECT 1 FROM rooms rm WHERE rm.id = room_id))
  WITH CHECK (EXISTS (SELECT 1 FROM rooms rm WHERE rm.id = room_id));

ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "jobs" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "maintenance_work_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenance_work_orders" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "marketing_content" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_content" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organizations" TO lc_app
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());

ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_intents" TO lc_app
  USING (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id))
  WITH CHECK (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id));

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payments" TO lc_app
  USING (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id))
  WITH CHECK (EXISTS (SELECT 1 FROM folios f WHERE f.id = folio_id));

ALTER TABLE "pos_order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_order_items" TO lc_app
  USING (EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = order_id));

ALTER TABLE "pos_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_orders" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "pos_outlets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_outlets" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "pos_products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_products" TO lc_app
  USING (EXISTS (SELECT 1 FROM pos_outlets o WHERE o.id = outlet_id))
  WITH CHECK (EXISTS (SELECT 1 FROM pos_outlets o WHERE o.id = outlet_id));

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "properties" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "property_access" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "property_access" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "rate_plan_rates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rate_plan_rates" TO lc_app
  USING (EXISTS (SELECT 1 FROM rate_plans rp WHERE rp.id = rate_plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM rate_plans rp WHERE rp.id = rate_plan_id));

ALTER TABLE "rate_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rate_plans" TO lc_app
  USING (EXISTS (SELECT 1 FROM room_types t WHERE t.id = room_type_id))
  WITH CHECK (EXISTS (SELECT 1 FROM room_types t WHERE t.id = room_type_id));

ALTER TABLE "reservation_groups" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservation_groups" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "reservation_nights" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservation_nights" TO lc_app
  USING (EXISTS (SELECT 1 FROM reservations r WHERE r.id = reservation_id))
  WITH CHECK (EXISTS (SELECT 1 FROM reservations r WHERE r.id = reservation_id));

ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reservations" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permissions" TO lc_app
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "room_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "room_types" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rooms" TO lc_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions" TO lc_app
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = user_id));

ALTER TABLE "user_role_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_role_assignments" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users" TO lc_app
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- The permission catalog is global reference data (no tenant), read-only for lc_app.
REVOKE INSERT, UPDATE, DELETE ON TABLE "permissions" FROM lc_app;

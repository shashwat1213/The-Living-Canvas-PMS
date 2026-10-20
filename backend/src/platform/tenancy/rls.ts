import { Prisma } from '@prisma/client';

import { getRequestContext } from './context.js';

/**
 * Database-level tenant isolation (Postgres Row Level Security).
 *
 * Every statement issued through the wrapped client runs inside a
 * transaction that first switches to the `lc_app` role (no BYPASSRLS) and
 * sets `app.org_id` to the caller's organization — both `SET LOCAL`, so they
 * vanish at COMMIT/ROLLBACK and can never leak onto a pooled connection that
 * another request picks up next. The policies in the `row_level_security`
 * migration then filter every row by that org.
 *
 * - Interactive `$transaction(async tx => …)`: the settings are applied once
 *   at the start; every statement on `tx` inherits them.
 * - Batch `$transaction([…])`: the settings statement is prepended to the
 *   batch and its result dropped.
 * - A lone query (no transaction): wrapped in a two-statement batch
 *   transaction (settings + the query).
 *
 * Statements already inside a transaction pass straight through, so nothing
 * is double-wrapped.
 */
const RLS_ROLE = 'lc_app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function applyTenantSettings(client: AnyClient) {
  const { organizationId } = getRequestContext();
  return client.$executeRaw(
    Prisma.sql`SELECT set_config('role', ${RLS_ROLE}, true), set_config('app.org_id', ${organizationId}, true)`,
  );
}

export function withRowLevelSecurity<C>(inner: C): C {
  const base = inner as AnyClient;
  const extended = base.$extends({
    name: 'row-level-security',
    client: {
      async $transaction(arg: unknown, options?: unknown) {
        if (typeof arg === 'function') {
          return base.$transaction(async (tx: AnyClient) => {
            await applyTenantSettings(tx);
            return (arg as (tx: AnyClient) => Promise<unknown>)(tx);
          }, options);
        }
        const results = await base.$transaction([applyTenantSettings(base), ...(arg as unknown[])], options);
        return (results as unknown[]).slice(1);
      },
    },
    query: {
      async $allOperations({
        args,
        query,
        __internalParams,
      }: {
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
        __internalParams?: { transaction?: unknown };
      }) {
        if (__internalParams?.transaction) {
          return query(args);
        }
        const [, result] = await base.$transaction([applyTenantSettings(base), query(args)]);
        return result;
      },
    },
  });
  return extended as C;
}

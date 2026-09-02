import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ALL_PERMISSIONS, SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS, type SystemRoleName } from './permissions.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Idempotently ensures every permission in the catalog (`permissions.ts`)
 * has a matching row. Safe to call repeatedly — used both by the seed
 * script and defensively before an organization is provisioned, so
 * organization creation doesn't depend on a separate seed step having
 * already run.
 */
export async function ensurePermissionCatalog(client: Db = prisma): Promise<void> {
  for (const permission of ALL_PERMISSIONS) {
    await client.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }
}

/**
 * Seeds the four built-in system roles, with their permission mappings,
 * for a newly created organization (Phase 1 decision #2). Every
 * organization gets its own copy so a future custom-role builder can
 * extend an individual organization's roles without a schema change.
 */
export async function seedSystemRoles(client: Prisma.TransactionClient, organizationId: string): Promise<void> {
  const permissions = await client.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  for (const roleName of SYSTEM_ROLE_NAMES) {
    const role = await client.role.create({ data: { organizationId, name: roleName, isSystem: true } });

    const permissionIds = SYSTEM_ROLE_PERMISSIONS[roleName].map((key) => {
      const id = permissionIdByKey.get(key);
      if (!id) {
        throw new Error(`Permission catalog is missing "${key}" — run ensurePermissionCatalog() first.`);
      }
      return id;
    });

    await client.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }
}

/**
 * Backfills newly-added permission keys onto the system roles of
 * organizations that already exist.
 *
 * `seedSystemRoles` runs exactly once per organization, at creation time,
 * so adding a key to `SYSTEM_ROLE_PERMISSIONS` otherwise reaches new
 * tenants only — every existing organization would silently never gain
 * it, and the same OWNER would have different powers depending on what
 * month they signed up. This closes that gap. Idempotent, and safe to run
 * against an already-current database.
 *
 * Deliberately **additive only**: it grants missing mappings and never
 * revokes an existing one. Revoking would make this a destructive
 * reconcile that could delete grants a future custom-role builder added
 * to a role, which is not a decision a seed step should be making on its
 * own.
 *
 * Returns the number of mappings added, so the caller can report whether
 * it was a no-op rather than guessing.
 */
export async function syncSystemRolePermissions(client: Db = prisma): Promise<number> {
  const permissions = await client.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  const roles = await client.role.findMany({
    where: { isSystem: true, name: { in: [...SYSTEM_ROLE_NAMES] } },
    include: { rolePermissions: { select: { permissionId: true } } },
  });

  let added = 0;
  for (const role of roles) {
    const desired = SYSTEM_ROLE_PERMISSIONS[role.name as SystemRoleName] ?? [];
    const held = new Set(role.rolePermissions.map((rolePermission) => rolePermission.permissionId));

    const missing: string[] = [];
    for (const key of desired) {
      const permissionId = permissionIdByKey.get(key);
      if (permissionId && !held.has(permissionId)) {
        missing.push(permissionId);
      }
    }
    if (missing.length === 0) continue;

    const result = await client.rolePermission.createMany({
      data: missing.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
    added += result.count;
  }

  return added;
}

/** Assigns a user to their organization's system role matching the given preset name. */
export async function assignSystemRole(
  client: Prisma.TransactionClient,
  params: { userId: string; organizationId: string; roleName: SystemRoleName },
): Promise<void> {
  const role = await client.role.findUniqueOrThrow({
    where: { organizationId_name: { organizationId: params.organizationId, name: params.roleName } },
  });
  await client.userRoleAssignment.create({
    data: { userId: params.userId, roleId: role.id, organizationId: params.organizationId },
  });
}

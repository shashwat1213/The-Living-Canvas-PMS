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

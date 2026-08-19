/**
 * The permission catalog (Phase 1 decision #2, see DECISIONS.md). This is
 * the source of truth for which permission keys exist — the `Permission`
 * table (backend/prisma/schema.prisma) mirrors it for referential
 * integrity and future admin-UI listing, seeded from `ALL_PERMISSIONS`
 * below (see `platform/rbac/seed.ts`).
 *
 * Scoped to exactly what Phase 1 needs (organizations/properties/rooms
 * CRUD, plus a `staff:manage` placeholder RolePermission mappings can
 * reference later). Extend this list when a module that needs new
 * permissions actually lands — don't pre-populate permissions for
 * features that don't exist yet.
 */
export const ALL_PERMISSIONS = [
  { key: 'organizations:read', description: "Read the caller's own organization." },
  { key: 'organizations:update', description: "Update the caller's own organization." },
  { key: 'properties:create', description: 'Create a property.' },
  { key: 'properties:read', description: 'Read properties.' },
  { key: 'properties:update', description: 'Update a property.' },
  { key: 'properties:delete', description: 'Delete a property.' },
  { key: 'rooms:create', description: 'Create a room.' },
  { key: 'rooms:read', description: 'Read rooms.' },
  { key: 'rooms:update', description: 'Update a room.' },
  { key: 'rooms:delete', description: 'Delete a room.' },
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: Permission[] = ALL_PERMISSIONS.map((p) => p.key);

/** The four built-in role presets, matching the `UserRole` enum on `User.role`. */
export const SYSTEM_ROLE_NAMES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/**
 * Default permission set per built-in role, seeded onto that role at
 * organization-creation time. OWNER/ADMIN are organization-wide (see
 * `platform/tenancy/context.ts` for how that's resolved against
 * PropertyAccess); MANAGER/STAFF are scoped down and additionally need a
 * PropertyAccess grant per property.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  OWNER: [...PERMISSION_KEYS],
  ADMIN: [...PERMISSION_KEYS],
  MANAGER: [
    'organizations:read',
    'properties:read',
    'properties:update',
    'rooms:create',
    'rooms:read',
    'rooms:update',
    'rooms:delete',
  ],
  STAFF: ['organizations:read', 'properties:read', 'rooms:read', 'rooms:update'],
};

/** Organization-wide roles bypass PropertyAccess grants entirely. */
export const ORG_WIDE_ROLES: ReadonlySet<SystemRoleName> = new Set(['OWNER', 'ADMIN']);

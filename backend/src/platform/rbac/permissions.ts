/**
 * The permission catalog (Phase 1 decision #2, see DECISIONS.md). This is
 * the source of truth for which permission keys exist — the `Permission`
 * table (backend/prisma/schema.prisma) mirrors it for referential
 * integrity and future admin-UI listing, seeded from `ALL_PERMISSIONS`
 * below (see `platform/rbac/seed.ts`).
 *
 * Scoped to exactly what the implemented modules need
 * (organizations/properties/rooms CRUD, plus staff management). Extend
 * this list when a module that needs new permissions actually lands —
 * don't pre-populate permissions for features that don't exist yet.
 *
 * Adding a key here is not self-applying to organizations that already
 * exist: `seedSystemRoles` only runs once, at organization-creation time.
 * Run `npm run db:seed -w backend` after adding one — it calls
 * `syncSystemRolePermissions` (see `provisioning.ts`), which backfills the
 * new mapping onto every existing organization's system roles.
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
  { key: 'staff:read', description: "Read the organization's staff members." },
  {
    key: 'staff:manage',
    description: 'Create staff, change their role, manage their property access, and deactivate them.',
  },
  {
    key: 'audit:read',
    description: "Read the organization's audit trail.",
  },
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
    // Read-only: a manager can see who works in the organization, but
    // `staff:manage` (create / role-change / deactivate) stays with
    // OWNER/ADMIN. The role-rank rules in `modules/staff/service.ts` are a
    // second, independent limit on top of this one.
    'staff:read',
    // `audit:read` is deliberately absent here and for STAFF: the audit
    // trail records administrative actions taken *on* people, including
    // by the roles above this one. Restricting it to OWNER/ADMIN (who
    // receive it via the PERMISSION_KEYS spread) is the intended scope,
    // not an oversight.
  ],
  STAFF: ['organizations:read', 'properties:read', 'rooms:read', 'rooms:update'],
};

/** Organization-wide roles bypass PropertyAccess grants entirely. */
export const ORG_WIDE_ROLES: ReadonlySet<SystemRoleName> = new Set(['OWNER', 'ADMIN']);

/**
 * Relative authority of the built-in roles. Used only by staff management
 * (`modules/staff/service.ts`) to answer two questions a permission check
 * alone cannot: "may this caller hand out that role?" and "may this
 * caller act on that particular staff member?".
 *
 * Without a rank, `staff:manage` would be a flat privilege — any ADMIN
 * could mint an OWNER, demote a peer, or lock out the account above
 * theirs, all while passing the permission guard. Rank is deliberately
 * kept separate from `SYSTEM_ROLE_PERMISSIONS`: permissions say what
 * actions exist, rank says who may be on the receiving end of one.
 */
export const ROLE_RANK: Record<SystemRoleName, number> = {
  OWNER: 3,
  ADMIN: 2,
  MANAGER: 1,
  STAFF: 0,
};

/**
 * The highest rank among the roles a user actually holds. Returns -1 for
 * a user holding no recognized system role — "outranked by everyone",
 * the safe direction: such a user can never manage anybody, and every
 * rank comparison against them is decided by a real role rather than by a
 * default that happens to tie.
 */
export function highestRoleRank(roleNames: Iterable<SystemRoleName>): number {
  let highest = -1;
  for (const name of roleNames) {
    const rank = ROLE_RANK[name];
    if (rank !== undefined && rank > highest) {
      highest = rank;
    }
  }
  return highest;
}

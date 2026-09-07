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
  {
    key: 'room-types:read',
    description: 'Read the room-type catalogue of a property.',
  },
  {
    key: 'room-types:manage',
    description: "Create, update and retire a property's room types.",
  },
  {
    key: 'rate-plans:read',
    description: 'Read the rate plans and per-date rates of a room type.',
  },
  {
    key: 'rate-plans:manage',
    description: "Create, update, retire and price a room type's rate plans.",
  },
  {
    key: 'guests:read',
    description: "Read the organization's guest profiles.",
  },
  {
    key: 'guests:manage',
    description: "Create, update and delete guest profiles.",
  },
  {
    key: 'reservations:read',
    description: "Read a property's reservations.",
  },
  {
    key: 'reservations:manage',
    description: 'Create, cancel and mark no-show on reservations.',
  },
  {
    key: 'payments:read',
    description: "Read a reservation's folio, charges and payments.",
  },
  {
    key: 'payments:manage',
    description: 'Post charges and record payments on a folio, and close it.',
  },
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
    // The room-type catalogue is inventory configuration, not front-desk
    // work: a manager sets up what a property sells, so `manage` belongs
    // here, while STAFF below gets read only. Deliberately NOT folded
    // into `rooms:*` — STAFF holds `rooms:update` so it can change a
    // room's status, and reusing that key would have let the front desk
    // rename the catalogue every rate and reservation will hang off.
    'room-types:read',
    'room-types:manage',
    // Rate plans are revenue configuration — the same "what a property sells
    // and for how much" territory as the room-type catalogue — so MANAGER
    // gets `manage` and STAFF (below) gets read only. A front-desk agent
    // reads the rate to quote it; it does not reprice the hotel.
    'rate-plans:read',
    'rate-plans:manage',
    // Guests are front-desk work: a manager (and staff, below) creates and
    // edits guest profiles as part of taking a booking, so both read and
    // manage sit at this level, unlike the revenue-config permissions above.
    'guests:read',
    'guests:manage',
    // Reservations are the core front-desk workflow: managers and staff both
    // take and cancel bookings, so both read and manage sit at this level.
    'reservations:read',
    'reservations:manage',
    // Billing is front-desk work too: settling the folio and taking payment
    // at check-out is the same daily desk job as taking the booking, so both
    // read and manage sit here (and for STAFF below).
    'payments:read',
    'payments:manage',
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
  STAFF: [
    'organizations:read',
    'properties:read',
    'rooms:read',
    'rooms:update',
    'room-types:read',
    'rate-plans:read',
    // The front desk creates and edits guest profiles when booking, so STAFF
    // holds manage here — the one place STAFF gets a manage permission.
    'guests:read',
    'guests:manage',
    // Taking and cancelling bookings is the front desk's core job.
    'reservations:read',
    'reservations:manage',
    // Settling the bill and taking payment at check-out is core desk work.
    'payments:read',
    'payments:manage',
  ],
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

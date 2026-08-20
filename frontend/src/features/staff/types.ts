/**
 * Domain types for staff management, mirroring exactly what
 * `backend/src/modules/staff` returns and accepts. There is no shared
 * types package between the workspaces yet (deferred until the
 * Reservations phase — see DECISIONS.md), so these are hand-written
 * against the real contract rather than generated.
 */

/** The four built-in role presets (`SYSTEM_ROLE_NAMES` on the backend). */
export const SYSTEM_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[number];

export const ROLE_LABEL: Record<SystemRoleName, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
};

/** What each role can do, in plain language, for the role picker. */
export const ROLE_DESCRIPTION: Record<SystemRoleName, string> = {
  OWNER: 'Full access to every property and all staff administration.',
  ADMIN: 'Same day-to-day access as an owner, across every property.',
  MANAGER: 'Manages rooms at the properties they are given access to.',
  STAFF: 'Views properties and updates room status where granted.',
};

/** Exactly the shape of a `staff` object in the API's responses. */
export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** The coarse label on `User.role`. */
  role: SystemRoleName;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** The roles actually driving authorization, from `UserRoleAssignment`. */
  roleNames: SystemRoleName[];
  /** Properties this member holds an explicit access grant for. */
  propertyIds: string[];
}

export interface CreateStaffInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: SystemRoleName;
  propertyIds?: string[];
}

/** Every field optional; the API requires at least one to be present. */
export interface UpdateStaffInput {
  firstName?: string;
  lastName?: string;
  role?: SystemRoleName;
  isActive?: boolean;
}

/**
 * The only thing staff management needs to know about a property: enough
 * to label a checkbox. Kept as a local view model rather than importing a
 * properties module — this feature depends on the *idea* of a property,
 * not on how that feature happens to model one.
 */
export interface PropertyOption {
  id: string;
  name: string;
}

export function fullName(member: StaffMember): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

/**
 * The role that actually governs a member's access. `roleNames` is the
 * real grant and `role` is the display label; they are kept in sync by
 * the backend, but when a record predates that guarantee the grant is the
 * one worth trusting.
 */
export function effectiveRole(member: StaffMember): SystemRoleName {
  return member.roleNames[0] ?? member.role;
}

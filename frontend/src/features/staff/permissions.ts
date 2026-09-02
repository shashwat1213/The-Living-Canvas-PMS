import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';
import type { StaffMember, SystemRoleName } from './types';
import { effectiveRole } from './types';

/**
 * A UI-side mirror of the staff authorization rules enforced in
 * `backend/src/modules/staff/service.ts`.
 *
 * ## Why this duplication exists, and what keeps it honest
 *
 * Duplicating server rules in a client is normally a mistake. The
 * exception is deciding what to *render*: a table that shows every user a
 * "Deactivate" button which only ever returns 403 is a worse product than
 * one that doesn't, and there is no way to know which rows those are
 * without knowing the rule.
 *
 * The rules below therefore decide **visibility only**. They never gate a
 * request: every action still goes to the server, and whatever it answers
 * — including "forbidden" — is what the user is shown. If this file ever
 * drifts from the backend, the consequence is a button that shouldn't
 * have been there (or one that should have been), never an action that
 * shouldn't have been allowed.
 *
 * Kept in one small file, rather than sprinkled through components, so
 * that drift has a single place to be found and corrected.
 */

/** Mirrors `ROLE_RANK` in `backend/src/platform/rbac/permissions.ts`. */
const ROLE_RANK: Record<SystemRoleName, number> = {
  OWNER: 3,
  ADMIN: 2,
  MANAGER: 1,
  STAFF: 0,
};

/** Mirrors the backend's `highestRoleRank`: -1 means "holds no known role". */
function highestRank(roleNames: readonly string[]): number {
  let highest = -1;
  for (const name of roleNames) {
    const rank = ROLE_RANK[name as SystemRoleName];
    if (rank !== undefined && rank > highest) highest = rank;
  }
  return highest;
}

export function canReadStaff(session: SessionClaims | null): boolean {
  return hasPermission(session, 'staff:read');
}

export function canManageStaff(session: SessionClaims | null): boolean {
  return hasPermission(session, 'staff:manage');
}

/** The caller's own authority level, from their token's resolved roles. */
export function callerRank(session: SessionClaims | null): number {
  return session ? highestRank(session.roleNames) : -1;
}

/**
 * Mirrors the backend's assign rule: you may not hand out a role above
 * your own rank. Used to narrow the role picker rather than to offer
 * choices that will be rejected on submit.
 */
export function assignableRoles(session: SessionClaims | null, roles: readonly SystemRoleName[]): SystemRoleName[] {
  const rank = callerRank(session);
  return roles.filter((role) => ROLE_RANK[role] <= rank);
}

export type ManageBlockedReason = 'self' | 'outranked' | null;

/**
 * Mirrors the backend's target rule: you may act only on a staff member
 * strictly below your own rank. That single comparison blocks acting on a
 * superior, on a peer, and on yourself — which is also why the last OWNER
 * of an organization can never be deactivated.
 *
 * Returns *why* an action is unavailable rather than a bare boolean, so
 * the UI can explain itself instead of silently hiding controls.
 */
export function manageBlockedReason(session: SessionClaims | null, member: StaffMember): ManageBlockedReason {
  if (!session) return 'outranked';
  if (member.id === session.userId) return 'self';
  if (highestRank(member.roleNames.length > 0 ? member.roleNames : [effectiveRole(member)]) >= callerRank(session)) {
    return 'outranked';
  }
  return null;
}

export function canManageMember(session: SessionClaims | null, member: StaffMember): boolean {
  return canManageStaff(session) && manageBlockedReason(session, member) === null;
}

export const MANAGE_BLOCKED_LABEL: Record<Exclude<ManageBlockedReason, null>, string> = {
  self: 'You cannot change your own role or account status.',
  outranked: 'This staff member is at or above your own role level.',
};

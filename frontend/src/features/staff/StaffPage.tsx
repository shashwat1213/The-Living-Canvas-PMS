import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError, apiFetch } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { listStaff, updateStaffMember } from './api';
import { canManageMember, canManageStaff, canReadStaff, manageBlockedReason, MANAGE_BLOCKED_LABEL } from './permissions';
import { StaffDialog } from './StaffDialog';
import {
  ROLE_LABEL,
  SYSTEM_ROLES,
  effectiveRole,
  fullName,
  type PropertyOption,
  type StaffMember,
  type SystemRoleName,
} from './types';
import './staff.css';

type RoleFilter = SystemRoleName | 'ALL';
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const ROLE_TONE: Record<SystemRoleName, 'accent' | 'neutral'> = {
  OWNER: 'accent',
  ADMIN: 'accent',
  MANAGER: 'neutral',
  STAFF: 'neutral',
};

export function StaffPage() {
  const { session } = useAuth();

  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** True while refetching an already-loaded list, so the table can stay
   * on screen instead of collapsing back to a loading placeholder. */
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  /** The term actually sent to the server — see the debounce effect below. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const [dialogMember, setDialogMember] = useState<StaffMember | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<StaffMember | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const mayRead = canReadStaff(session);
  const mayManage = canManageStaff(session);

  // Same brief, self-clearing confirmation the properties and rooms pages
  // use — the refreshed table is the lasting evidence.
  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await listStaff({
        search: appliedSearch || undefined,
        role: roleFilter === 'ALL' ? undefined : roleFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setStaff(result.staff);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setStaff([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load your team.');
    } finally {
      setRefreshing(false);
    }
  }, [appliedSearch, roleFilter, statusFilter, page]);

  // Debounce the search box so typing produces one request when the user
  // pauses, not one per keystroke. Filters and paging aren't debounced —
  // they're discrete choices, and delaying them would just feel laggy.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what's being asked for resets to the first page —
  // staying on page 4 of a result set that now has one page would show an
  // empty table for a filter that actually matched something.
  useEffect(() => {
    setPage(1);
  }, [appliedSearch, roleFilter, statusFilter]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  useEffect(() => {
    if (!mayRead) return;
    // The property list only drives the access picker, so a failure here
    // must not take the staff table down with it — the picker degrades to
    // "no properties" and everything else still works.
    apiFetch<{ properties: PropertyOption[] }>('/api/v1/properties')
      .then((res) => setProperties(res.properties))
      .catch(() => setProperties([]));
  }, [mayRead]);

  function openCreate() {
    setDialogMember(null);
    setDialogOpen(true);
  }

  function openMember(member: StaffMember) {
    setDialogMember(member);
    setDialogOpen(true);
  }

  async function handleDialogSaved(message: string) {
    setDialogOpen(false);
    await load();
    flashSuccess(message);
  }

  async function confirmStatusChange() {
    if (!pendingStatusChange) return;
    const member = pendingStatusChange;
    const reactivating = !member.isActive;
    setStatusSaving(true);
    setError(null);
    try {
      await updateStaffMember(member.id, { isActive: reactivating });
      setPendingStatusChange(null);
      await load();
      flashSuccess(
        reactivating
          ? `${fullName(member)} can sign in again.`
          : `${fullName(member)} was deactivated and signed out everywhere.`,
      );
    } catch (err) {
      setPendingStatusChange(null);
      setError(err instanceof ApiError ? err.message : 'Could not update this staff member.');
    } finally {
      setStatusSaving(false);
    }
  }

  // Permission-gated at the route as well as in the nav: reaching this
  // page directly by URL without `staff:read` gets an explanation rather
  // than an empty table or a raw 403 from the first request.
  if (!mayRead) {
    return (
      <section className="staff-page">
        <h1>Team</h1>
        <p className="empty-state">
          You don&apos;t have access to staff administration. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (member) => (
        <div className="staff-identity">
          <span className="staff-name">
            {fullName(member)}
            {member.id === session?.userId && <span className="staff-you"> (you)</span>}
          </span>
          <span className="staff-email">{member.email}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (member) => {
        const role = effectiveRole(member);
        return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (member) => (
        <Badge tone={member.isActive ? 'positive' : 'muted'}>{member.isActive ? 'Active' : 'Deactivated'}</Badge>
      ),
    },
    {
      key: 'access',
      header: 'Property access',
      secondary: true,
      render: (member) => {
        const role = effectiveRole(member);
        if (role === 'OWNER' || role === 'ADMIN') {
          return <span className="staff-muted">All properties</span>;
        }
        if (member.propertyIds.length === 0) {
          return <span className="staff-muted">None</span>;
        }
        return (
          <span className="staff-muted">
            {member.propertyIds.length} {member.propertyIds.length === 1 ? 'property' : 'properties'}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (member) => {
        const blocked = manageBlockedReason(session, member);
        const manageable = canManageMember(session, member);
        return (
          <div className="table-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openMember(member)}>
              {manageable ? 'Edit' : 'View'}
            </button>
            {mayManage &&
              (manageable ? (
                <button
                  type="button"
                  className={member.isActive ? 'btn btn-ghost btn-sm staff-danger-text' : 'btn btn-ghost btn-sm'}
                  onClick={() => setPendingStatusChange(member)}
                >
                  {member.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              ) : (
                // Explained rather than silently missing, so the absence
                // of a control doesn't read as a bug.
                <span className="staff-blocked" title={blocked ? MANAGE_BLOCKED_LABEL[blocked] : undefined}>
                  {blocked === 'self' ? 'Your account' : 'Restricted'}
                </span>
              ))}
          </div>
        );
      },
    },
  ];

  const filtersActive = search.trim() !== '' || roleFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <section className="staff-page">
      <header className="staff-header">
        <div>
          <h1>Team</h1>
          <p className="staff-subtitle">
            Everyone who can sign in to your organization, and what they can reach.
          </p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Add staff member
          </button>
        )}
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="page-success" role="status">
          {success}
        </p>
      )}

      <div className="staff-filters">
        <div className="field staff-search">
          <label htmlFor="staff-search">Search</label>
          <input
            id="staff-search"
            type="search"
            placeholder="Name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="staff-role-filter">Role</label>
          <select
            id="staff-role-filter"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          >
            <option value="ALL">All roles</option>
            {SYSTEM_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="staff-status-filter">Status</label>
          <select
            id="staff-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Deactivated</option>
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={staff}
        rowKey={(member) => member.id}
        caption="Staff members in your organization"
        highlightRow={(member) => member.id === session?.userId}
        emptyState={
          filtersActive ? (
            <>
              <p>No one matches those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm staff-clear-filters"
                onClick={() => {
                  setSearch('');
                  setRoleFilter('ALL');
                  setStatusFilter('ALL');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              {mayManage
                ? 'No staff yet — add your first team member above.'
                : 'No staff to show yet.'}
            </p>
          )
        }
      />

      {pageMeta && (
        <Pagination
          page={pageMeta}
          onPageChange={setPage}
          itemLabel="people"
          itemLabelSingular="person"
          busy={refreshing}
        />
      )}

      {dialogOpen && (
        <StaffDialog
          member={dialogMember}
          properties={properties}
          session={session}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleDialogSaved(message)}
        />
      )}

      {pendingStatusChange && (
        <ConfirmDialog
          title={pendingStatusChange.isActive ? 'Deactivate staff member?' : 'Reactivate staff member?'}
          message={
            pendingStatusChange.isActive
              ? `${fullName(pendingStatusChange)} will be signed out of every device immediately and won't be able to sign in again until reactivated.`
              : `${fullName(pendingStatusChange)} will be able to sign in again with their existing password.`
          }
          confirmLabel={pendingStatusChange.isActive ? 'Deactivate' : 'Reactivate'}
          destructive={pendingStatusChange.isActive}
          busy={statusSaving}
          onConfirm={() => void confirmStatusChange()}
          onCancel={() => setPendingStatusChange(null)}
        />
      )}
    </section>
  );
}

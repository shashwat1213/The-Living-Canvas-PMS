import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, type BadgeTone } from '../../components/Badge';
import { Pagination } from '../../components/Pagination';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { getBoard, listTasks, setRoomCondition, updateTask } from './api';
import { canManageHousekeeping, canReadHousekeeping } from './permissions';
import { TaskDialog } from './TaskDialog';
import {
  HOUSEKEEPING_STATUS_LABEL,
  OCCUPANCY_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Board,
  type BoardRoom,
  type HousekeepingStatus,
  type HousekeepingTask,
  type Occupancy,
  type TaskStatus,
} from './types';
import './housekeeping.css';

/** Today in UTC as YYYY-MM-DD — the board's default date. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const CONDITION_TONE: Record<HousekeepingStatus, BadgeTone> = {
  DIRTY: 'muted',
  CLEANING: 'accent',
  CLEAN: 'neutral',
  INSPECTED: 'positive',
};

const OCCUPANCY_TONE: Record<Occupancy, BadgeTone> = {
  DEPARTURE: 'accent',
  ARRIVAL: 'neutral',
  STAYOVER: 'muted',
  VACANT: 'muted',
};

const TASK_STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  PENDING: 'muted',
  IN_PROGRESS: 'accent',
  DONE: 'positive',
  CANCELLED: 'muted',
};

/**
 * The forward action offered on a room, following the daily flow
 * dirty → cleaning → clean → inspected. The last state has no forward step.
 */
const NEXT_CONDITION: Partial<Record<HousekeepingStatus, HousekeepingStatus>> = {
  DIRTY: 'CLEANING',
  CLEANING: 'CLEAN',
  CLEAN: 'INSPECTED',
};

type View = 'board' | 'tasks';

export function HousekeepingPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const mayRead = canReadHousekeeping(session);
  const mayManage = canManageHousekeeping(session);

  const [view, setView] = useState<View>('board');
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Board state
  const [date, setDate] = useState(todayUtc());
  const [board, setBoard] = useState<Board | null>(null);

  // Tasks state
  const [tasks, setTasks] = useState<HousekeepingTask[] | null>(null);
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageMeta, setTaskPageMeta] = useState<{ page: number; pageSize: number; totalItems: number; totalPages: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadBoard = useCallback(async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      const result = await getBoard(propertyId, date);
      setBoard(result);
      setError(null);
    } catch (err) {
      setBoard(null);
      setError(err instanceof ApiError ? err.message : 'Could not load the housekeeping board.');
    } finally {
      setBusy(false);
    }
  }, [propertyId, date]);

  const loadTasks = useCallback(async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      const result = await listTasks(propertyId, { page: taskPage, status: statusFilter || undefined });
      setTasks(result.tasks);
      setTaskPageMeta(result.page);
      setError(null);
    } catch (err) {
      setTasks([]);
      setError(err instanceof ApiError ? err.message : 'Could not load housekeeping tasks.');
    } finally {
      setBusy(false);
    }
  }, [propertyId, taskPage, statusFilter]);

  useEffect(() => {
    if (!mayRead) return;
    if (view === 'board') void loadBoard();
    else void loadTasks();
  }, [mayRead, view, loadBoard, loadTasks]);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  async function changeCondition(room: BoardRoom, next: HousekeepingStatus) {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    try {
      await setRoomCondition(propertyId, room.id, next);
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the room condition.');
      setBusy(false);
    }
  }

  async function changeTaskStatus(task: HousekeepingTask, next: TaskStatus) {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    try {
      await updateTask(propertyId, task.id, { status: next });
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the task.');
      setBusy(false);
    }
  }

  if (!mayRead) {
    return (
      <section className="housekeeping-page">
        <h1>Housekeeping</h1>
        <p className="empty-state">
          You don&apos;t have access to housekeeping. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  return (
    <section className="housekeeping-page">
      <p className="hk-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="hk-header">
        <div>
          <h1>Housekeeping{property ? ` — ${property.name}` : ''}</h1>
          <p className="hk-subtitle">
            Room conditions and cleaning tasks. A dirty room is still bookable — this tracks readiness to hand over the key.
          </p>
        </div>
        <div className="hk-tabs" role="tablist" aria-label="Housekeeping views">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'board'}
            className={`btn btn-sm ${view === 'board' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'tasks'}
            className={`btn btn-sm ${view === 'tasks' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setView('tasks')}
          >
            Tasks
          </button>
        </div>
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {view === 'board' ? (
        <>
          <div className="hk-board-controls">
            <label className="hk-date-label">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayUtc())}
                disabled={busy}
                aria-label="Board date"
              />
            </label>
            {board && (
              <div className="hk-summary" aria-live="polite">
                <span className="hk-chip hk-chip-dirty">{board.summary.dirty} dirty</span>
                <span className="hk-chip hk-chip-cleaning">{board.summary.cleaning} cleaning</span>
                <span className="hk-chip hk-chip-clean">{board.summary.clean} clean</span>
                <span className="hk-chip hk-chip-inspected">{board.summary.inspected} inspected</span>
                <span className="hk-chip hk-chip-dep">{board.summary.departures} departures</span>
              </div>
            )}
          </div>

          {board === null ? (
            <p className="page-loading" role="status">
              Loading board…
            </p>
          ) : board.rooms.length === 0 ? (
            <div className="empty-state">
              No rooms at this property yet. Add rooms from the{' '}
              <Link to={`/app/properties/${propertyId}/rooms`}>Rooms</Link> screen first.
            </div>
          ) : (
            <div className="hk-grid">
              {board.rooms.map((room) => {
                const next = NEXT_CONDITION[room.housekeepingStatus];
                return (
                  <article key={room.id} className={`hk-card hk-card-${room.housekeepingStatus.toLowerCase()}`}>
                    <div className="hk-card-head">
                      <span className="hk-card-name">{room.name}</span>
                      <Badge tone={CONDITION_TONE[room.housekeepingStatus]}>
                        {HOUSEKEEPING_STATUS_LABEL[room.housekeepingStatus]}
                      </Badge>
                    </div>
                    <div className="hk-card-meta">
                      <span>{room.roomType.name}</span>
                      {room.floor && <span className="hk-muted"> · Floor {room.floor}</span>}
                    </div>
                    <div className="hk-card-flags">
                      {room.occupancy !== 'VACANT' && (
                        <Badge tone={OCCUPANCY_TONE[room.occupancy]}>{OCCUPANCY_LABEL[room.occupancy]}</Badge>
                      )}
                      {room.status !== 'ACTIVE' && <Badge tone="muted">Out of service</Badge>}
                      {room.openTasks > 0 && (
                        <span className="hk-tasks-badge">
                          {room.openTasks} task{room.openTasks === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {mayManage && (
                      <div className="hk-card-actions">
                        {next && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void changeCondition(room, next)}
                          >
                            Mark {HOUSEKEEPING_STATUS_LABEL[next].toLowerCase()}
                          </button>
                        )}
                        {room.housekeepingStatus !== 'DIRTY' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void changeCondition(room, 'DIRTY')}
                          >
                            Mark dirty
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="hk-task-controls">
            <label className="hk-filter-label">
              Status
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as TaskStatus | '');
                  setTaskPage(1);
                }}
                disabled={busy}
              >
                <option value="">All</option>
                {(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            {mayManage && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialogOpen(true)}>
                New task
              </button>
            )}
          </div>

          {tasks === null ? (
            <p className="page-loading" role="status">
              Loading tasks…
            </p>
          ) : tasks.length === 0 ? (
            <div className="empty-state">No housekeeping tasks match this filter.</div>
          ) : (
            <div className="hk-task-list">
              {tasks.map((task) => (
                <article key={task.id} className="hk-task">
                  <div className="hk-task-main">
                    <span className="hk-task-room">{task.room.name}</span>
                    <span className="hk-muted">
                      {TASK_TYPE_LABEL[task.type]} · {task.room.roomType.name}
                    </span>
                    {task.assignedTo && (
                      <span className="hk-muted">
                        · {task.assignedTo.firstName} {task.assignedTo.lastName}
                      </span>
                    )}
                    {task.notes && <p className="hk-task-notes">{task.notes}</p>}
                  </div>
                  <div className="hk-task-side">
                    <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
                    {mayManage && (
                      <div className="hk-task-actions">
                        {task.status === 'PENDING' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void changeTaskStatus(task, 'IN_PROGRESS')}
                          >
                            Start
                          </button>
                        )}
                        {(task.status === 'PENDING' || task.status === 'IN_PROGRESS') && (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() => void changeTaskStatus(task, 'DONE')}
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => void changeTaskStatus(task, 'CANCELLED')}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {(task.status === 'DONE' || task.status === 'CANCELLED') && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void changeTaskStatus(task, 'PENDING')}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {taskPageMeta && (
            <Pagination page={taskPageMeta} onPageChange={setTaskPage} itemLabel="tasks" busy={busy} />
          )}
        </>
      )}

      {dialogOpen && propertyId && (
        <TaskDialog
          propertyId={propertyId}
          rooms={board?.rooms ?? []}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setTaskPage(1);
            void loadTasks();
          }}
        />
      )}
    </section>
  );
}

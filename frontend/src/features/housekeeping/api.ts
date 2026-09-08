import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { Board, CreateTaskInput, HousekeepingStatus, HousekeepingTask, TaskListParams, UpdateTaskInput } from './types';

/**
 * The only place housekeeping endpoints are named. Housekeeping lives under a
 * property, so every call carries the property id — the backend resolves it
 * through the tenant-scoped client, which is what makes a cross-organization
 * property (or room/task) a 404 rather than a leak.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/housekeeping`;

export function getBoard(propertyId: string, date?: string): Promise<Board> {
  return apiFetch<{ board: Board }>(`${base(propertyId)}/board${toQueryString(date ? { date } : {})}`).then(
    (res) => res.board,
  );
}

export function setRoomCondition(
  propertyId: string,
  roomId: string,
  housekeepingStatus: HousekeepingStatus,
): Promise<{ id: string; housekeepingStatus: HousekeepingStatus }> {
  return apiFetch<{ room: { id: string; housekeepingStatus: HousekeepingStatus } }>(
    `${base(propertyId)}/rooms/${roomId}/condition`,
    { method: 'PUT', body: { housekeepingStatus } },
  ).then((res) => res.room);
}

export interface TaskListResult {
  tasks: HousekeepingTask[];
  page: PageMeta;
}

export function listTasks(propertyId: string, params: TaskListParams = {}): Promise<TaskListResult> {
  return apiFetch<TaskListResult>(`${base(propertyId)}/tasks${toQueryString({ ...params })}`);
}

export function createTask(propertyId: string, input: CreateTaskInput): Promise<HousekeepingTask> {
  return apiFetch<{ task: HousekeepingTask }>(`${base(propertyId)}/tasks`, { method: 'POST', body: input }).then(
    (res) => res.task,
  );
}

export function updateTask(propertyId: string, taskId: string, input: UpdateTaskInput): Promise<HousekeepingTask> {
  return apiFetch<{ task: HousekeepingTask }>(`${base(propertyId)}/tasks/${taskId}`, {
    method: 'PATCH',
    body: input,
  }).then((res) => res.task);
}

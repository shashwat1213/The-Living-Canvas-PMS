/** Cleaning conditions a room can be in — mirrors the backend `HousekeepingStatus`. */
export const HOUSEKEEPING_STATUSES = ['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED'] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];

export const HOUSEKEEPING_STATUS_LABEL: Record<HousekeepingStatus, string> = {
  DIRTY: 'Dirty',
  CLEANING: 'Cleaning',
  CLEAN: 'Clean',
  INSPECTED: 'Inspected',
};

/** Task lifecycle and kind, mirroring the backend enums. */
export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export const TASK_TYPES = ['DEPARTURE', 'STAYOVER', 'TURNDOWN', 'OTHER'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  DEPARTURE: 'Departure',
  STAYOVER: 'Stayover',
  TURNDOWN: 'Turndown',
  OTHER: 'Other',
};

/** Derived per-room occupancy on the board's date. */
export type Occupancy = 'ARRIVAL' | 'DEPARTURE' | 'STAYOVER' | 'VACANT';

export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  ARRIVAL: 'Arrival',
  DEPARTURE: 'Departure',
  STAYOVER: 'Stayover',
  VACANT: 'Vacant',
};

export interface BoardRoom {
  id: string;
  name: string;
  floor: string | null;
  /** Inventory/service status (ACTIVE/INACTIVE/MAINTENANCE). */
  status: string;
  housekeepingStatus: HousekeepingStatus;
  roomType: { id: string; name: string; code: string | null };
  occupancy: Occupancy;
  openTasks: number;
}

export interface BoardSummary {
  totalRooms: number;
  dirty: number;
  cleaning: number;
  clean: number;
  inspected: number;
  departures: number;
  arrivals: number;
  stayovers: number;
}

export interface Board {
  date: string;
  rooms: BoardRoom[];
  summary: BoardSummary;
}

export interface HousekeepingTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  room: { id: string; name: string; floor: string | null; roomType: { id: string; name: string; code: string | null } };
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
}

export interface TaskListParams {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  type?: TaskType;
  roomId?: string;
  assignedToId?: string;
}

export interface CreateTaskInput {
  roomId: string;
  type?: TaskType;
  assignedToId?: string | null;
  notes?: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  type?: TaskType;
  assignedToId?: string | null;
  notes?: string | null;
}

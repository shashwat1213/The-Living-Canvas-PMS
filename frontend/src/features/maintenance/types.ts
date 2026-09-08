export const WORK_ORDER_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
};

export const WORK_ORDER_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_PRIORITY_LABEL: Record<WorkOrderPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const WORK_ORDER_CATEGORIES = [
  'HVAC',
  'PLUMBING',
  'ELECTRICAL',
  'APPLIANCE',
  'FURNITURE',
  'STRUCTURAL',
  'SAFETY',
  'OTHER',
] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];

export const WORK_ORDER_CATEGORY_LABEL: Record<WorkOrderCategory, string> = {
  HVAC: 'HVAC',
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  APPLIANCE: 'Appliance',
  FURNITURE: 'Furniture',
  STRUCTURAL: 'Structural',
  SAFETY: 'Safety',
  OTHER: 'Other',
};

export interface WorkOrder {
  id: string;
  propertyId: string;
  title: string;
  description: string | null;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  takesRoomOutOfService: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  room: { id: string; name: string; floor: string | null; status: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
}

export interface WorkOrderListParams {
  page?: number;
  pageSize?: number;
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  category?: WorkOrderCategory;
  roomId?: string;
  assignedToId?: string;
  search?: string;
}

export interface CreateWorkOrderInput {
  title: string;
  description?: string;
  roomId?: string | null;
  category?: WorkOrderCategory;
  priority?: WorkOrderPriority;
  assignedToId?: string | null;
  takeRoomOutOfService?: boolean;
}

export interface UpdateWorkOrderInput {
  title?: string;
  description?: string | null;
  category?: WorkOrderCategory;
  priority?: WorkOrderPriority;
  status?: WorkOrderStatus;
  assignedToId?: string | null;
  takeRoomOutOfService?: boolean;
}

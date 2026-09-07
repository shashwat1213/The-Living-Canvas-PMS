import { useEffect, useState } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listRooms } from '../rooms/api';
import type { Room } from '../rooms/types';
import { createWorkOrder } from './api';
import {
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_CATEGORY_LABEL,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABEL,
  type WorkOrderCategory,
  type WorkOrderPriority,
} from './types';

interface WorkOrderDialogProps {
  propertyId: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Log a maintenance work order. Room is optional (a property-level order for a
 * common area has none); when a room is chosen, "Take room out of service"
 * flips it to MAINTENANCE — removing it from sellable inventory — as part of
 * opening the order. Rooms are loaded from the property's own room list.
 */
export function WorkOrderDialog({ propertyId, onClose, onCreated }: WorkOrderDialogProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [roomId, setRoomId] = useState('');
  const [category, setCategory] = useState<WorkOrderCategory>('OTHER');
  const [priority, setPriority] = useState<WorkOrderPriority>('MEDIUM');
  const [takeOut, setTakeOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A generous page is fine here — the picker wants the whole (small) room
    // list, not a paginated slice. Failure is non-fatal: the order can still
    // be a property-level one with no room.
    listRooms(propertyId, { pageSize: 100 })
      .then((res) => setRooms(res.rooms))
      .catch(() => setRooms([]));
  }, [propertyId]);

  async function handleSave() {
    if (!title.trim()) {
      setError('Give the work order a title.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createWorkOrder(propertyId, {
        title: title.trim(),
        description: description.trim() || undefined,
        roomId: roomId || null,
        category,
        priority,
        takeRoomOutOfService: Boolean(roomId) && takeOut,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the work order.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New work order"
      description="Log an engineering issue. Attach a room, or leave it property-wide for a common area."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy || !title.trim()}>
            Create work order
          </button>
        </>
      }
    >
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      <div className="mx-form">
        <label className="mx-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            maxLength={200}
            placeholder="e.g. AC not cooling"
          />
        </label>
        <div className="mx-field-row">
          <label className="mx-field">
            Room (optional)
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={busy}>
              <option value="">Property-wide (no room)</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mx-field">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as WorkOrderCategory)} disabled={busy}>
              {WORK_ORDER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {WORK_ORDER_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="mx-field">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrderPriority)} disabled={busy}>
              {WORK_ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {WORK_ORDER_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mx-field">
          Description (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            maxLength={2000}
            placeholder="What's wrong, and anything the engineer should know"
          />
        </label>
        <label className={`mx-checkbox ${!roomId ? 'mx-checkbox-disabled' : ''}`}>
          <input type="checkbox" checked={takeOut} onChange={(e) => setTakeOut(e.target.checked)} disabled={busy || !roomId} />
          Take this room out of service (removes it from sellable inventory until resolved)
        </label>
      </div>
    </Modal>
  );
}

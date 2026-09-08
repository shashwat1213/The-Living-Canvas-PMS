import { useState } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createTask } from './api';
import { TASK_TYPE_LABEL, TASK_TYPES, type BoardRoom, type TaskType } from './types';

interface TaskDialogProps {
  propertyId: string;
  /** Rooms to pick from — sourced from the board so no extra fetch is needed. */
  rooms: BoardRoom[];
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Create a housekeeping task against a room. Room and type are chosen from the
 * board's own room list; notes are optional. Assignment to a specific staff
 * member is left to the task list's own controls (it needs staff:read, which
 * not every housekeeping user holds), so a task is created unassigned here and
 * handed out later.
 */
export function TaskDialog({ propertyId, rooms, onClose, onCreated }: TaskDialogProps) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [type, setType] = useState<TaskType>('DEPARTURE');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!roomId) {
      setError('Choose a room for the task.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTask(propertyId, { roomId, type, notes: notes.trim() || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New housekeeping task"
      description="Schedule a clean on a room. Assign it to a housekeeper from the task list once created."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy || !roomId}>
            Create task
          </button>
        </>
      }
    >
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {rooms.length === 0 ? (
        <p className="empty-state">
          Open the Board tab first so its rooms are loaded, then create a task.
        </p>
      ) : (
        <div className="hk-form">
          <label className="hk-field">
            Room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={busy}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} — {room.roomType.name}
                </option>
              ))}
            </select>
          </label>
          <label className="hk-field">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as TaskType)} disabled={busy}>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="hk-field">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Extra towels, guest requested late clean"
            />
          </label>
        </div>
      )}
    </Modal>
  );
}

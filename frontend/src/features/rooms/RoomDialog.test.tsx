/**
 * The room-type picker (Phase 2 task 2c/2d).
 *
 * The rule these cover: the catalogue is a convenience, never a gate. A
 * room stays creatable when the catalogue is empty or fails to load,
 * which is what keeps the legacy free-text flow working while the
 * transition is in progress.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomDialog } from './RoomDialog';
import type { Room } from './types';

const { createRoom, updateRoom, listRoomTypes } = vi.hoisted(() => ({
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  listRoomTypes: vi.fn(),
}));

vi.mock('./api', () => ({ createRoom, updateRoom }));
vi.mock('../room-types/api', () => ({ listRoomTypes }));

const PROPERTY_ID = 'prop-1';

function roomType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    propertyId: PROPERTY_ID,
    name: 'Deluxe King',
    code: 'DLXK',
    description: null,
    isActive: true,
    roomCount: 2,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function existingRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    propertyId: PROPERTY_ID,
    name: '101',
    roomType: 'Deluxe King',
    roomTypeId: null,
    floor: '1',
    capacity: 2,
    status: 'ACTIVE',
    notes: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(room: Room | null = null) {
  return render(<RoomDialog propertyId={PROPERTY_ID} room={room} onClose={vi.fn()} onSaved={vi.fn()} />);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RoomDialog room-type picker', () => {
  it('sends roomTypeId when a catalogue type is chosen, and no free-text label', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    createRoom.mockResolvedValue(existingRoom({ name: '303' }));
    renderDialog();

    // Waits for the catalogue to arrive: before it does, the field is
    // still the free-text fallback, so asserting on the label alone would
    // race the fetch. The code is shown alongside the name — it is what
    // staff read on a rooming list.
    await screen.findByRole('option', { name: 'Deluxe King (DLXK)' });
    const select = screen.getByLabelText('Room type');
    expect(select.tagName).toBe('SELECT');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '303' } });
    fireEvent.change(select, { target: { value: 'rt-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    const payload = createRoom.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.roomTypeId).toBe('rt-1');
    // The server derives the label; sending one too would let the two drift.
    expect(payload).not.toHaveProperty('roomType');
  });

  it('falls back to free text when "Other" is chosen, clearing the link', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    createRoom.mockResolvedValue(existingRoom());
    renderDialog();

    await screen.findByRole('option', { name: 'Deluxe King (DLXK)' });
    const select = screen.getByLabelText('Room type');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '304' } });
    fireEvent.change(select, { target: { value: '' } });

    fireEvent.change(await screen.findByLabelText('Room type label'), { target: { value: 'Rooftop Cabana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    expect(createRoom.mock.calls[0]?.[1]).toMatchObject({ roomType: 'Rooftop Cabana', roomTypeId: null });
  });

  it('stays usable as a plain text field when the property has no room types', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [], page: {} });
    createRoom.mockResolvedValue(existingRoom());
    renderDialog();

    await waitFor(() => expect(listRoomTypes).toHaveBeenCalled());
    const input = screen.getByLabelText('Room type');
    expect(input.tagName).toBe('INPUT');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '305' } });
    fireEvent.change(input, { target: { value: 'Standard Twin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    expect(createRoom.mock.calls[0]?.[1]).toMatchObject({ roomType: 'Standard Twin', roomTypeId: null });
  });

  it('still creates a room when the catalogue request fails outright', async () => {
    listRoomTypes.mockRejectedValue(new Error('network'));
    createRoom.mockResolvedValue(existingRoom());
    renderDialog();

    await waitFor(() => expect(listRoomTypes).toHaveBeenCalled());
    const input = await screen.findByLabelText('Room type');
    expect(input.tagName).toBe('INPUT');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '306' } });
    fireEvent.change(input, { target: { value: 'Fallback Suite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    expect(createRoom.mock.calls[0]?.[1]).toMatchObject({ roomType: 'Fallback Suite' });
  });

  it('preselects the room’s existing type when editing', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    updateRoom.mockResolvedValue(existingRoom({ roomTypeId: 'rt-1' }));
    renderDialog(existingRoom({ roomTypeId: 'rt-1' }));

    await screen.findByRole('option', { name: 'Deluxe King (DLXK)' });
    const select = screen.getByLabelText('Room type') as HTMLSelectElement;
    expect(select.value).toBe('rt-1');
  });

  it('keeps showing a retired type the room is still linked to', async () => {
    // The catalogue only returns ACTIVE types. A room linked to a retired
    // one must not silently reset to "Other" just because the dialog opened.
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    renderDialog(existingRoom({ roomTypeId: 'rt-retired', roomType: 'Retired Suite' }));

    await screen.findByRole('option', { name: 'Retired Suite' });
    const select = screen.getByLabelText('Room type') as HTMLSelectElement;
    expect(select.value).toBe('rt-retired');
    expect(screen.getByRole('option', { name: 'Retired Suite' })).toBeInTheDocument();
  });

  it('requires a label when no type is chosen, and sends nothing', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [], page: {} });
    renderDialog();

    await waitFor(() => expect(listRoomTypes).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '307' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    expect(await screen.findByText('Room type is required.')).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
  });
});

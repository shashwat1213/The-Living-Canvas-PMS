/**
 * The room-type picker (catalogue-only model — see the rooms-catalogue-only
 * slice / TASKS.md task 2e).
 *
 * The rule these cover: a room is always assigned a type from the
 * property's RoomType catalogue. There is no free-text fallback. When the
 * property has no active types, create is blocked with an empty state that
 * points at the catalogue rather than showing an unsubmittable form.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    roomTypeId: 'rt-1',
    roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLXK' },
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
  return render(
    <MemoryRouter>
      <RoomDialog propertyId={PROPERTY_ID} room={room} onClose={vi.fn()} onSaved={vi.fn()} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RoomDialog room-type picker', () => {
  it('sends roomTypeId when a catalogue type is chosen, and no free-text label', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    createRoom.mockResolvedValue(existingRoom({ name: '303' }));
    renderDialog();

    // The code is shown alongside the name — it is what staff read on a
    // rooming list.
    await screen.findByRole('option', { name: 'Deluxe King (DLXK)' });
    const select = screen.getByLabelText('Room type');
    expect(select.tagName).toBe('SELECT');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '303' } });
    fireEvent.change(select, { target: { value: 'rt-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    const payload = createRoom.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.roomTypeId).toBe('rt-1');
    // Catalogue-only: there is no free-text label to send at all.
    expect(payload).not.toHaveProperty('roomType');
  });

  it('blocks create with an empty state when the property has no room types', async () => {
    listRoomTypes.mockResolvedValue({ roomTypes: [], page: {} });
    renderDialog();

    await waitFor(() => expect(listRoomTypes).toHaveBeenCalled());
    // No form to submit; the user is pointed at the catalogue instead.
    expect(await screen.findByText('No room types yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage room types' })).toHaveAttribute(
      'href',
      `/app/properties/${PROPERTY_ID}/room-types`,
    );
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('surfaces a load failure and disables submit rather than inventing a fallback', async () => {
    listRoomTypes.mockRejectedValue(new Error('network'));
    renderDialog();

    await waitFor(() => expect(listRoomTypes).toHaveBeenCalled());
    expect(await screen.findByText(/Could not load room types/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeDisabled();
    expect(createRoom).not.toHaveBeenCalled();
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
    // one must not silently reset just because the dialog opened.
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    renderDialog(
      existingRoom({ roomTypeId: 'rt-retired', roomType: { id: 'rt-retired', name: 'Retired Suite', code: null } }),
    );

    await screen.findByRole('option', { name: 'Retired Suite' });
    const select = screen.getByLabelText('Room type') as HTMLSelectElement;
    expect(select.value).toBe('rt-retired');
  });

  it('requires a type to be chosen, and sends nothing until one is', async () => {
    // A single active type exists but the user must still actively confirm
    // it — the select starts on the disabled "Select a room type" prompt.
    listRoomTypes.mockResolvedValue({ roomTypes: [roomType()], page: {} });
    renderDialog();

    await screen.findByRole('option', { name: 'Deluxe King (DLXK)' });
    const select = screen.getByLabelText('Room type') as HTMLSelectElement;
    expect(select.value).toBe('');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '307' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }));

    expect(await screen.findByText('Choose a room type.')).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
  });
});

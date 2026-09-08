import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../../auth/AuthContext';
import { readSessionClaims } from '../../auth/session';
import { HousekeepingPage } from './HousekeepingPage';
import type { TaskListResult } from './api';
import type { Board } from './types';

const PROPERTY_ID = 'prop-1';

function makeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function session(permissions: string[]) {
  return readSessionClaims(
    makeToken({
      sub: 'user-1',
      organizationId: 'org-1',
      permissions,
      roleNames: ['OWNER'],
      grantedPropertyIds: [PROPERTY_ID],
    }),
  );
}

const manageSession = () => session(['housekeeping:read', 'housekeeping:manage']);
const readOnlySession = () => session(['housekeeping:read']);
const noAccessSession = () => session(['properties:read']);

function board(): Board {
  return {
    date: '2026-10-03',
    rooms: [
      {
        id: 'room-1',
        name: '101',
        floor: '1',
        status: 'ACTIVE',
        housekeepingStatus: 'DIRTY',
        roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' },
        occupancy: 'DEPARTURE',
        openTasks: 1,
      },
      {
        id: 'room-2',
        name: '102',
        floor: '1',
        status: 'ACTIVE',
        housekeepingStatus: 'INSPECTED',
        roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' },
        occupancy: 'VACANT',
        openTasks: 0,
      },
    ],
    summary: { totalRooms: 2, dirty: 1, cleaning: 0, clean: 0, inspected: 1, departures: 1, arrivals: 0, stayovers: 0 },
  };
}

function tasks(): TaskListResult {
  return {
    tasks: [
      {
        id: 'task-1',
        type: 'DEPARTURE',
        status: 'PENDING',
        notes: 'Turn over after checkout',
        completedAt: null,
        createdAt: '2026-10-03T08:00:00.000Z',
        updatedAt: '2026-10-03T08:00:00.000Z',
        room: { id: 'room-1', name: '101', floor: '1', roomType: { id: 'rt-1', name: 'Deluxe King', code: 'DLX' } },
        assignedTo: null,
      },
    ],
    page: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

interface StubOptions {
  onCondition?: (url: string, init: RequestInit) => void;
  onTaskPatch?: (url: string, init: RequestInit) => void;
}

function stubApi(options: StubOptions = {}) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    if (url.includes('/housekeeping/board')) {
      return Promise.resolve(jsonResponse({ board: board() }));
    }
    if (url.includes('/housekeeping/tasks') && (init.method === undefined || init.method === 'GET')) {
      return Promise.resolve(jsonResponse(tasks()));
    }
    if (url.match(/\/rooms\/[^/]+\/condition/) && init.method === 'PUT') {
      options.onCondition?.(url, init);
      return Promise.resolve(jsonResponse({ room: { id: 'room-1', housekeepingStatus: 'CLEANING' } }));
    }
    if (url.match(/\/tasks\/[^/]+$/) && init.method === 'PATCH') {
      options.onTaskPatch?.(url, init);
      return Promise.resolve(jsonResponse({ task: { ...tasks().tasks[0], status: 'IN_PROGRESS' } }));
    }
    // getProperty
    return Promise.resolve(jsonResponse({ property: { id: PROPERTY_ID, name: 'Seaside Villa' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(sessionValue: AuthContextValue['session']) {
  const value: AuthContextValue = {
    status: 'authenticated',
    session: sessionValue,
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[`/app/properties/${PROPERTY_ID}/housekeeping`]}>
        <Routes>
          <Route path="/app/properties/:propertyId/housekeeping" element={<HousekeepingPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HousekeepingPage', () => {
  it('renders the board with room cards, conditions and occupancy', async () => {
    stubApi();
    renderPage(manageSession());

    expect(await screen.findByRole('heading', { name: 'Housekeeping — Seaside Villa' })).toBeInTheDocument();
    // Both rooms present with their condition badges.
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.getByText('Dirty')).toBeInTheDocument();
    expect(screen.getByText('Inspected')).toBeInTheDocument();
    // Departure flag and the summary chip.
    expect(screen.getByText('Departure')).toBeInTheDocument();
    expect(screen.getByText('1 dirty')).toBeInTheDocument();
  });

  it('sends the forward condition transition (DIRTY → CLEANING) on the action button', async () => {
    let sent: { url: string; body: unknown } | null = null;
    stubApi({ onCondition: (url, init) => (sent = { url, body: JSON.parse(String(init.body)) }) });
    renderPage(manageSession());

    // Room 101 is DIRTY, so its forward action is "Mark cleaning".
    const button = await screen.findByRole('button', { name: /Mark cleaning/i });
    fireEvent.click(button);

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.url).toContain('/rooms/room-1/condition');
    expect(sent!.body).toEqual({ housekeepingStatus: 'CLEANING' });
  });

  it('switches to the Tasks view and moves a task with a PATCH', async () => {
    let patched: { url: string; body: unknown } | null = null;
    stubApi({ onTaskPatch: (url, init) => (patched = { url, body: JSON.parse(String(init.body)) }) });
    renderPage(manageSession());

    await screen.findByRole('heading', { name: 'Housekeeping — Seaside Villa' });
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    // The pending task shows; starting it PATCHes status IN_PROGRESS.
    const start = await screen.findByRole('button', { name: 'Start' });
    fireEvent.click(start);

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.url).toContain('/tasks/task-1');
    expect(patched!.body).toEqual({ status: 'IN_PROGRESS' });
  });

  it('hides management controls from a read-only user', async () => {
    stubApi();
    renderPage(readOnlySession());

    await screen.findByRole('heading', { name: 'Housekeeping — Seaside Villa' });
    // No condition-change buttons for a user without housekeeping:manage.
    expect(screen.queryByRole('button', { name: /Mark cleaning/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark dirty/i })).not.toBeInTheDocument();
  });

  it('explains its absence to a user without housekeeping:read', async () => {
    stubApi();
    renderPage(noAccessSession());

    expect(await screen.findByText(/don.t have access to housekeeping/i)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Board' })).not.toBeInTheDocument();
  });
});

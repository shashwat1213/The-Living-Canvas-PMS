import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaLibrary } from './MediaLibrary';
import type { MediaAsset } from './media-api';

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'm1',
    propertyId: 'prop-1',
    kind: 'IMAGE',
    status: 'READY',
    fileName: 'lobby.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    title: 'Lobby lights',
    description: null,
    album: 'Diwali 2026',
    tags: ['festive'],
    width: 800,
    height: 600,
    durationMs: null,
    sourceAssetId: null,
    url: 'https://bucket.example/lobby.jpg?sig=1',
    createdBy: { id: 'u1', firstName: 'Aarav', lastName: 'Mehta' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;

function stubApi(items: MediaAsset[], calls: { method: string; url: string; body?: unknown }[] = []) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    calls.push({
      method,
      url: u,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (u.endsWith('/marketing/media/albums'))
      return Promise.resolve(json({ albums: [{ album: 'Diwali 2026', count: 1 }] }));
    if (method === 'POST' && u.endsWith('/marketing/media/uploads')) {
      return Promise.resolve(
        json(
          {
            asset: asset({ id: 'new', status: 'PENDING', url: null }),
            uploadUrl: 'https://bucket.example/put?sig=x',
            uploadHeaders: { 'Content-Type': 'image/png' },
          },
          201,
        ),
      );
    }
    if (method === 'POST' && u.endsWith('/new/complete')) return Promise.resolve(json({ media: asset({ id: 'new' }) }));
    return Promise.resolve(
      json({
        media: items,
        page: {
          page: 1,
          pageSize: 24,
          totalItems: items.length,
          totalPages: 1,
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MediaLibrary', () => {
  it('shows albums and the media grid', async () => {
    stubApi([asset()]);
    render(<MediaLibrary propertyId="prop-1" canManage />);
    expect(await screen.findByRole('img', { name: 'Lobby lights' })).toHaveAttribute(
      'src',
      'https://bucket.example/lobby.jpg?sig=1',
    );
    expect(screen.getByRole('tab', { name: /Diwali 2026/ })).toBeInTheDocument();
    expect(screen.getByText(/Drop event photos or videos here/)).toBeInTheDocument();
  });

  it('hides upload controls for read-only users', async () => {
    stubApi([]);
    render(<MediaLibrary propertyId="prop-1" canManage={false} />);
    expect(await screen.findByText(/A manager can upload/)).toBeInTheDocument();
    expect(screen.queryByText(/Drop event photos/)).not.toBeInTheDocument();
  });

  it('uploads via presigned URL then completes', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    stubApi([], calls);

    // Fake XHR for the direct-to-storage PUT.
    const sent: { url?: string; headers: Record<string, string> } = {
      headers: {},
    };
    class FakeXhr {
      upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
      status = 200;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      open(_m: string, url: string) {
        sent.url = url;
      }
      setRequestHeader(k: string, v: string) {
        sent.headers[k] = v;
      }
      send() {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    class FakeImage {
      naturalWidth = 1200;
      naturalHeight = 800;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
      }),
    );

    render(<MediaLibrary propertyId="prop-1" canManage />);
    await screen.findByText(/No media yet/);

    fireEvent.change(screen.getByLabelText('Album / event'), {
      target: { value: 'Sharma Wedding' },
    });
    const file = new File(['x'.repeat(10)], 'mandap.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Upload media files'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/new/complete'))).toBe(true));
    const presign = calls.find((c) => c.url.endsWith('/uploads'));
    expect(presign?.body).toMatchObject({
      fileName: 'mandap.png',
      contentType: 'image/png',
      sizeBytes: 10,
      album: 'Sharma Wedding',
      width: 1200,
      height: 800,
    });
    expect(sent.url).toBe('https://bucket.example/put?sig=x');
    expect(sent.headers['Content-Type']).toBe('image/png');
  });

  it('rejects unsupported files before uploading', async () => {
    const calls: { method: string; url: string }[] = [];
    stubApi([], calls);
    render(<MediaLibrary propertyId="prop-1" canManage />);
    await screen.findByText(/No media yet/);
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Upload media files'), {
      target: { files: [svg] },
    });
    expect(await screen.findByText('Unsupported file type.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/uploads'))).toBe(false);
  });
});

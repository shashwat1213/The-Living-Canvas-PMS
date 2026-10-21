import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';

/** Mirrors `MediaAssetView` in backend/src/modules/media/service.ts. */
export interface MediaAsset {
  id: string;
  propertyId: string;
  kind: 'IMAGE' | 'VIDEO';
  status: 'PENDING' | 'READY';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  title: string | null;
  description: string | null;
  album: string | null;
  tags: string[];
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sourceAssetId: string | null;
  url: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaListParams {
  kind?: 'IMAGE' | 'VIDEO';
  album?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/marketing/media`;

export function listMedia(propertyId: string, params: MediaListParams = {}) {
  return apiFetch<{ media: MediaAsset[]; page: PageMeta }>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function listAlbums(propertyId: string) {
  return apiFetch<{ albums: { album: string; count: number }[] }>(`${base(propertyId)}/albums`);
}

export function updateMedia(
  propertyId: string,
  id: string,
  input: {
    title?: string | null;
    description?: string | null;
    album?: string | null;
    tags?: string[];
  },
) {
  return apiFetch<{ media: MediaAsset }>(`${base(propertyId)}/${id}`, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteMedia(propertyId: string, id: string) {
  return apiFetch<void>(`${base(propertyId)}/${id}`, { method: 'DELETE' });
}

export function getDownloadUrl(propertyId: string, id: string) {
  return apiFetch<{ url: string }>(`${base(propertyId)}/${id}/download`);
}

/** Reads pixel size / duration in the browser so the library can show it.
 * Best-effort: gives up after 4s so a file the browser can't decode never
 * blocks the upload. */
function probe(file: File): Promise<{ width?: number; height?: number; durationMs?: number }> {
  return Promise.race([
    probeInner(file),
    new Promise<Record<string, never>>((resolve) => setTimeout(() => resolve({}), 4000)),
  ]);
}

async function probeInner(file: File): Promise<{ width?: number; height?: number; durationMs?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('unreadable'));
        img.src = url;
      });
      return {
        width: img.naturalWidth || undefined,
        height: img.naturalHeight || undefined,
      };
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('unreadable'));
      video.src = url;
    });
    return {
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
    };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads one file: ask the API for a presigned URL, PUT the bytes straight
 * to storage (with progress), then ask the API to verify and publish it.
 */
export async function uploadMedia(
  propertyId: string,
  file: File,
  meta: { album?: string; tags?: string[] },
  onProgress?: (fraction: number) => void,
): Promise<MediaAsset> {
  const dims = await probe(file);
  const { asset, uploadUrl, uploadHeaders } = await apiFetch<{
    asset: MediaAsset;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  }>(`${base(propertyId)}/uploads`, {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      ...(meta.album ? { album: meta.album } : {}),
      ...(meta.tags && meta.tags.length ? { tags: meta.tags } : {}),
      ...dims,
    },
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    Object.entries(uploadHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(file);
  });

  const done = await apiFetch<{ media: MediaAsset }>(`${base(propertyId)}/${asset.id}/complete`, { method: 'POST' });
  return done.media;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

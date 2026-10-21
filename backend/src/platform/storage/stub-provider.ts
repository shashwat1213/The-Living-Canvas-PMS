import type { StorageProvider, StoredObjectInfo } from './provider.js';

/**
 * In-memory storage for tests and for running without S3 credentials. URLs
 * are inert `stub://` strings; tests simulate the browser's upload with
 * `stubPutObject`.
 */
const objects = new Map<string, StoredObjectInfo>();

export function stubPutObject(storageKey: string, info: StoredObjectInfo): void {
  objects.set(storageKey, info);
}

export function stubHasObject(storageKey: string): boolean {
  return objects.has(storageKey);
}

export const stubStorageProvider: StorageProvider = {
  key: 'stub',
  async createUploadUrl({ storageKey }) {
    return `stub://upload/${storageKey}`;
  },
  async createDownloadUrl({ storageKey }) {
    return `stub://download/${storageKey}`;
  },
  async headObject(storageKey) {
    return objects.get(storageKey) ?? null;
  },
  async deleteObject(storageKey) {
    objects.delete(storageKey);
  },
};

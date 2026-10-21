import type { StorageProvider } from './provider.js';
import { createS3StorageProvider } from './s3-provider.js';
import { stubStorageProvider } from './stub-provider.js';

/** The active storage provider — stub by default, S3 once configured. */
let active: StorageProvider = stubStorageProvider;

export function setStorageProvider(provider: StorageProvider): void {
  active = provider;
}

export function getStorageProvider(): StorageProvider {
  return active;
}

export function resetStorageProvider(): void {
  active = stubStorageProvider;
}

/** Activates S3 when MEDIA_S3_BUCKET is set; returns the bucket name or null. */
export function tryActivateS3FromEnv(): string | null {
  const provider = createS3StorageProvider();
  if (!provider) return null;
  setStorageProvider(provider);
  return process.env.MEDIA_S3_BUCKET ?? null;
}

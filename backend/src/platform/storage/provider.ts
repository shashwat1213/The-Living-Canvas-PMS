/**
 * Object-storage seam for user media (Marketing Studio library). The app
 * never streams file bytes itself: the browser uploads straight to the
 * bucket with a short-lived presigned PUT URL and reads through presigned
 * GET URLs. That keeps large photos/videos off the serverless function
 * (request-size + duration limits) and keeps the bucket fully private.
 */
export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageProvider {
  /** Short provider key recorded for diagnostics, e.g. "s3" or "stub". */
  readonly key: string;
  /** Presigned URL the browser PUTs the file to. */
  createUploadUrl(input: { storageKey: string; contentType: string; expiresInSeconds: number }): Promise<string>;
  /** Presigned URL the browser GETs (displays / downloads) the file from. */
  createDownloadUrl(input: { storageKey: string; expiresInSeconds: number; downloadName?: string }): Promise<string>;
  /** Metadata of an uploaded object, or null when it does not exist. */
  headObject(storageKey: string): Promise<StoredObjectInfo | null>;
  deleteObject(storageKey: string): Promise<void>;
}

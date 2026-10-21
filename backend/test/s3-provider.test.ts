import { describe, expect, it } from 'vitest';

import { createS3StorageProvider } from '../src/platform/storage/s3-provider.js';

const base = { MEDIA_S3_BUCKET: 'livingcanvas2026' } as NodeJS.ProcessEnv;

describe('S3 storage provider configuration', () => {
  it('stays inactive without a bucket', () => {
    expect(createS3StorageProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('signs URLs for the Mumbai bucket by default, without embedding any secret', async () => {
    const p = createS3StorageProvider({
      ...base,
      // Stand-in session creds so presigning doesn't hit the real chain.
      AWS_ACCESS_KEY_ID: 'ASIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'example',
    } as NodeJS.ProcessEnv);
    const prev = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
    process.env.AWS_ACCESS_KEY_ID = 'ASIAEXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'example';
    try {
      const url = new URL(
        await p!.createUploadUrl({ storageKey: 'orgs/o/x.jpg', contentType: 'image/jpeg', expiresInSeconds: 900 }),
      );
      expect(url.host).toBe('livingcanvas2026.s3.ap-south-1.amazonaws.com');
      expect(url.searchParams.get('X-Amz-Credential')).toContain('/ap-south-1/s3/aws4_request');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.toString()).not.toContain('example');
    } finally {
      process.env.AWS_ACCESS_KEY_ID = prev.id;
      process.env.AWS_SECRET_ACCESS_KEY = prev.secret;
      if (prev.id === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      if (prev.secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  });

  it('ignores static keys against real AWS (they are only for a custom MinIO endpoint)', () => {
    // No throw and still a provider — the keys are simply not used.
    const p = createS3StorageProvider({
      ...base,
      MEDIA_S3_ACCESS_KEY_ID: 'AKIASHOULDNOTBEUSED',
      MEDIA_S3_SECRET_ACCESS_KEY: 'nope',
    } as NodeJS.ProcessEnv);
    expect(p?.key).toBe('s3');
  });
});

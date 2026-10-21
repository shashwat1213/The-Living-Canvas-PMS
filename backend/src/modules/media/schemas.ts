import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/** Accepted upload types. SVG is excluded on purpose (scriptable). */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const ALLOWED_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const albumSchema = z.string().trim().min(1).max(80);

export const createUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    contentType: z.enum(ALLOWED_CONTENT_TYPES),
    sizeBytes: z.number().int().min(1),
    title: z.string().trim().max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    album: albumSchema.optional(),
    tags: tagsSchema.optional(),
    width: z.number().int().min(1).max(20000).optional(),
    height: z.number().int().min(1).max(20000).optional(),
    durationMs: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    const isVideo = v.contentType.startsWith('video/');
    const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (v.sizeBytes > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizeBytes'],
        message: `File is too large (max ${Math.round(max / 1024 / 1024)} MB for ${isVideo ? 'videos' : 'images'}).`,
      });
    }
  });
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const updateAssetSchema = z
  .object({
    title: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    album: albumSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const listAssetsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(['IMAGE', 'VIDEO']).optional(),
  album: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

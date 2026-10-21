import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// Loaded lazily by @vercel/functions/oidc; imported here so the serverless
// bundler always ships it alongside the function.
import '@aws-sdk/credential-provider-web-identity';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import { awsCredentialsProvider } from '@vercel/functions/oidc';

import type { StorageProvider } from './provider.js';

/**
 * AWS S3 (or an S3-compatible store such as MinIO for local Docker) adapter.
 *
 * Credentials — never long-lived AWS keys in config:
 *  - Vercel: `MEDIA_S3_ROLE_ARN` → the function exchanges its Vercel OIDC
 *    token for short-lived credentials of that IAM role
 *    (AssumeRoleWithWebIdentity). The role's trust policy only accepts this
 *    project's production token.
 *  - Local / other hosts: the default AWS credential chain — e.g.
 *    `AWS_PROFILE=ams`, or an instance/task role on EC2/ECS.
 *  - MinIO (custom `MEDIA_S3_ENDPOINT` only): MEDIA_S3_ACCESS_KEY_ID /
 *    MEDIA_S3_SECRET_ACCESS_KEY are the local MinIO user's keys; they are
 *    ignored when talking to real AWS.
 *
 * Env: MEDIA_S3_BUCKET (activates S3), MEDIA_S3_REGION (default ap-south-1),
 * MEDIA_S3_ROLE_ARN, MEDIA_S3_ENDPOINT, MEDIA_S3_FORCE_PATH_STYLE,
 * MEDIA_S3_PUBLIC_ENDPOINT (browser-facing host when it differs, e.g. MinIO
 * behind Docker networking).
 */
export const DEFAULT_MEDIA_REGION = 'ap-south-1';

export function createS3StorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider | null {
  const bucket = env.MEDIA_S3_BUCKET;
  if (!bucket) return null;
  const region = env.MEDIA_S3_REGION || DEFAULT_MEDIA_REGION;
  const endpoint = env.MEDIA_S3_ENDPOINT || undefined;
  const forcePathStyle = env.MEDIA_S3_FORCE_PATH_STYLE === 'true';

  let credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider | undefined;
  if (env.MEDIA_S3_ROLE_ARN) {
    credentials = awsCredentialsProvider({
      roleArn: env.MEDIA_S3_ROLE_ARN,
      roleSessionName: 'living-canvas-media',
      clientConfig: { region },
    });
  } else if (endpoint && env.MEDIA_S3_ACCESS_KEY_ID && env.MEDIA_S3_SECRET_ACCESS_KEY) {
    credentials = { accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY };
  }
  // else: undefined → AWS SDK default provider chain.

  const client = new S3Client({ region, credentials, endpoint, forcePathStyle });
  // Presigned URLs must use the host the *browser* can reach.
  const signer = env.MEDIA_S3_PUBLIC_ENDPOINT
    ? new S3Client({ region, credentials, endpoint: env.MEDIA_S3_PUBLIC_ENDPOINT, forcePathStyle })
    : client;

  return {
    key: 's3',
    async createUploadUrl({ storageKey, contentType, expiresInSeconds }) {
      return getSignedUrl(signer, new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: contentType }), {
        expiresIn: expiresInSeconds,
      });
    },
    async createDownloadUrl({ storageKey, expiresInSeconds, downloadName }) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          ...(downloadName
            ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, '_')}"` }
            : {}),
        }),
        { expiresIn: expiresInSeconds },
      );
    },
    async headObject(storageKey) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
        return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
      } catch (error: unknown) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === 'NotFound') return null;
        throw error;
      }
    },
    async deleteObject(storageKey) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
    },
  };
}

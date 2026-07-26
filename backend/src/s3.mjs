import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Bucket name comes from the SAM environment variable injected at deploy time
export const AUDIO_BUCKET = process.env.AUDIO_BUCKET || '';

// Singleton S3 client — reused across warm Lambda invocations
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Presigned GET URLs are minted fresh on every playback request rather than
// stored — a URL saved once in DynamoDB would go stale long before the audio
// itself expires (see AudioRetentionDays in template.yaml). Keep this well
// under API Gateway/Lambda's own timeout so a signed URL is never handed out
// after this Lambda invocation itself would have expired anyway.
const PRESIGN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Upload an audio object. Caller is responsible for size/content-type validation. */
export async function uploadAudio(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket:      AUDIO_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  }));
}

/** Returns true if the object exists, false on a clean 404 — rethrows anything else. */
export async function audioObjectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: AUDIO_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Mint a short-lived presigned GET URL for an existing object. */
export async function getAudioPresignedUrl(key) {
  const command = new GetObjectCommand({ Bucket: AUDIO_BUCKET, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
  return { url, expiresIn: PRESIGN_TTL_SECONDS };
}

/** Best-effort delete — swallows errors so a cleanup failure never blocks the
 *  DynamoDB delete it accompanies (an orphaned S3 object is recoverable via
 *  the lifecycle rule; a stuck history-delete request is not). */
export async function deleteAudio(key) {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: AUDIO_BUCKET, Key: key }));
  } catch (err) {
    console.error(`Failed to delete S3 audio object "${key}":`, err);
  }
}

export async function deleteAudioObjects(keys) {
  await Promise.all([...new Set(keys.filter(Boolean))].map(deleteAudio));
}

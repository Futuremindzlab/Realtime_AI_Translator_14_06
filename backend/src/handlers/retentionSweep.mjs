import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db, TRANSLATIONS_TABLE } from '../db.mjs';
import { deleteAudioObjects } from '../s3.mjs';

/**
 * Scheduled, account-agnostic retention sweep — invoked directly by
 * EventBridge (see template.yaml's RetentionSweepFunction Schedule event),
 * NOT through API Gateway, so there's no Cognito JWT/claims on `event` here.
 *
 * This is deliberately separate from translations.mjs's deleteOldTranslations
 * (DELETE /v1/translations/old): that route is per-user and requires
 * getUserId(event) from an authenticated request — it can only ever act on
 * the caller's own history, and nothing currently calls it on a schedule.
 * Without something like this sweep, a stated retention period in the
 * privacy policy is an unenforced claim: S3's own lifecycle rule already
 * expires audio objects after AudioRetentionDays (see the AudioBucket
 * resource), but the DynamoDB conversation_history rows referencing them
 * don't expire on their own and would otherwise accumulate forever with
 * dead audio_key references.
 *
 * Uses the SAME RetentionDays parameter as the S3 lifecycle rule (passed in
 * as RETENTION_DAYS) so there's one source of truth for "how long we keep
 * data," which is what the privacy policy needs to state accurately.
 *
 * Implementation note: conversation_history's key schema is
 * (user_id HASH, timestamp RANGE) with no GSI on timestamp alone, so finding
 * "everything past the cutoff, across every user" means a table Scan rather
 * than a per-user Query. Acceptable at this app's current scale for a rule
 * that runs once a day; if the table grows large enough for this to matter,
 * the fix is a GSI keyed on a constant partition (or a coarse date bucket)
 * + timestamp — not a reason to skip enforcing retention in the meantime.
 */
export async function handler() {
  const retentionDays = Number(process.env.RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  console.log(`🧹 Retention sweep: deleting conversation_history rows older than ${cutoff} (${retentionDays} days)`);

  let deleted = 0;
  let lastEvaluatedKey;

  do {
    const scanResult = await db.send(new ScanCommand({
      TableName: TRANSLATIONS_TABLE,
      FilterExpression: '#ts < :cutoff',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':cutoff': cutoff },
      ProjectionExpression: 'user_id, #ts, source_audio_key, translated_audio_key',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = scanResult.Items || [];
    lastEvaluatedKey = scanResult.LastEvaluatedKey;

    if (items.length > 0) {
      const chunks = [];
      for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
      }
      for (const chunk of chunks) {
        await db.send(new BatchWriteCommand({
          RequestItems: {
            [TRANSLATIONS_TABLE]: chunk.map((item) => ({
              DeleteRequest: { Key: { user_id: item.user_id, timestamp: item.timestamp } },
            })),
          },
        }));
      }
      await deleteAudioObjects(items.flatMap((i) => [i.source_audio_key, i.translated_audio_key]));
      deleted += items.length;
    }
  } while (lastEvaluatedKey);

  console.log(`✅ Retention sweep complete: ${deleted} row(s) deleted`);
  return { deleted, cutoff, retentionDays };
}

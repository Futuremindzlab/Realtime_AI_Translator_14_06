/**
 * Fixed-window rate limiting backed by DynamoDB.
 *
 * Used by the one unauthenticated route in this backend
 * (POST /v1/auth/phone/request-otp), where every call costs real money and
 * creates Cognito users: without a limit, anyone can loop it to send SMS at
 * the account's expense ("SMS pumping") or fill the user pool with junk users.
 *
 * A conditional ADD on a per-window item is the whole mechanism — it is atomic,
 * so concurrent Lambda containers can't exceed the limit between them, and the
 * item's TTL attribute lets DynamoDB clean up expired windows for free.
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, RATE_LIMIT_TABLE } from '../db.mjs';

/**
 * Consumes one unit against `key` for the current window.
 * Throws a structured 429 once the limit is reached.
 * Fails closed only on the limit itself: if the table isn't configured, the
 * check is skipped rather than blocking sign-in outright.
 */
export async function consumeRateLimit(key, { limit, windowSeconds }) {
  if (!RATE_LIMIT_TABLE) return;

  const nowSeconds  = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(nowSeconds / windowSeconds);
  const windowEnd   = (windowIndex + 1) * windowSeconds;

  try {
    await db.send(new UpdateCommand({
      TableName:        RATE_LIMIT_TABLE,
      Key:              { rate_key: `${key}#${windowIndex}` },
      UpdateExpression: 'SET expires_at = :exp ADD request_count :one',
      ConditionExpression: 'attribute_not_exists(request_count) OR request_count < :limit',
      ExpressionAttributeValues: { ':exp': windowEnd, ':one': 1, ':limit': limit },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const rateErr = new Error('Too many requests — please try again later');
      rateErr.statusCode = 429;
      throw rateErr;
    }
    throw err;
  }
}

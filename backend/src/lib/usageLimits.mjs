import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../db.mjs';
import { getUserPlan } from './entitlement.mjs';

export const USAGE_TABLE = process.env.USAGE_TABLE || 'ai_usage';

/**
 * Placeholder daily caps per plan — bound worst-case cost exposure (a leaked
 * token, a runaway conversation-mode retry loop) on the metered OpenAI/
 * ElevenLabs/Azure routes in aiProxy.mjs. These are NOT tuned against real
 * per-call cost or observed traffic — pick real numbers once you have either,
 * and if you want quotas to be a marketed plan feature, surface the actual
 * numbers in the UI and keep them in sync with whatever's set here.
 */
export const DAILY_AI_CALL_LIMITS = { basic: 20, plus: 150, live: 500 };

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

/**
 * Atomically increments today's AI-proxy call counter for this user and
 * throws a 429 (via the same err.statusCode + handleError() convention every
 * route already uses) once they're over their plan's daily cap. Call at the
 * top of every aiProxy.mjs route, right after getUserId(event).
 *
 * The increment and the limit check aren't a single atomic compare-and-set,
 * so this tolerates a small race window under concurrent requests — fine
 * here since the goal is bounding worst-case cost, not exact billing-grade
 * metering; a user might occasionally get a request or two past their cap
 * under heavy concurrency, never meaningfully more.
 */
export async function enforceDailyAiCallLimit(userId) {
  const plan = await getUserPlan(userId);
  const limit = DAILY_AI_CALL_LIMITS[plan] ?? DAILY_AI_CALL_LIMITS.basic;

  const day = todayKey();
  // Auto-expire ~2 days out via the table's TTL attribute (see template.yaml)
  // — comfortable margin past "today" in any timezone, and means this table
  // needs no manual cleanup, unlike conversation_history (see
  // retentionSweep.mjs) which has no TTL of its own.
  const ttl = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;

  const result = await db.send(new UpdateCommand({
    TableName: USAGE_TABLE,
    Key: { user_id: userId, day },
    UpdateExpression: 'ADD requests :incr SET expires_at = if_not_exists(expires_at, :ttl)',
    ExpressionAttributeValues: { ':incr': 1, ':ttl': ttl },
    ReturnValues: 'UPDATED_NEW',
  }));

  const count = result.Attributes?.requests ?? 1;
  if (count > limit) {
    const err = new Error(
      `Daily AI usage limit reached for the '${plan}' plan (${limit} requests/day). Try again tomorrow, or upgrade your plan.`
    );
    err.statusCode = 429;
    throw err;
  }
}

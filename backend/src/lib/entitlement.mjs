import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';

/**
 * Subscription tiers. Kept here as the single source of truth so every gated
 * route (Phase 1 streaming, Phase 2 live) imports the same list rather than
 * re-typing plan strings.
 *
 * 'basic' — today's batch pipeline (record → transcribe → translate → TTS → play).
 * 'plus'  — streaming pipeline (Lambda Function URL + per-sentence TTS).
 * 'live'  — WebRTC session direct to OpenAI's Realtime API.
 */
export const PLANS = ['basic', 'plus', 'live'];

const PLAN_RANK = Object.fromEntries(PLANS.map((p, i) => [p, i]));

/**
 * Reads a user's plan straight from DynamoDB — deliberately NOT trusting
 * anything the client sends (a JWT claim would go stale until token refresh;
 * this is always current). Defaults to 'basic' for both a missing settings
 * record and a pre-Phase-0 record that predates the `plan` attribute, so no
 * backfill/migration step is needed for existing users.
 */
export async function getUserPlan(userId) {
  const result = await db.send(new GetCommand({
    TableName: SETTINGS_TABLE,
    Key: { user_id: userId },
  }));
  const plan = result.Item?.plan;
  return PLANS.includes(plan) ? plan : 'basic';
}

/**
 * True if `plan` meets or exceeds `minimum` in the basic < plus < live order.
 * Higher tiers include lower-tier capabilities (a 'live' subscriber can still
 * use the plain streaming route, etc.) — this is a >=, not an ===.
 */
export function planMeets(plan, minimum) {
  return (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[minimum] ?? 0);
}

/**
 * Convenience guard for a gated route handler: looks up the caller's plan and
 * throws a 403-shaped error (via the same handleError() every route already
 * uses) if it doesn't meet `minimum`. Usage:
 *
 *   const userId = getUserId(event);
 *   await requirePlan(userId, 'plus');
 */
export async function requirePlan(userId, minimum) {
  const plan = await getUserPlan(userId);
  if (!planMeets(plan, minimum)) {
    const err = new Error(`This feature requires the '${minimum}' plan or higher (current plan: '${plan}').`);
    err.statusCode = 403;
    throw err;
  }
  return plan;
}

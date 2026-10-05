import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../db.mjs';
import { getUserPlan } from './entitlement.mjs';

export const USAGE_TABLE = process.env.USAGE_TABLE || 'ai_usage';

/**
 * Daily AI-proxy call caps per plan — bound worst-case cost exposure (a
 * leaked token, a runaway conversation-mode retry loop) on the metered
 * OpenAI/ElevenLabs/Azure routes in aiProxy.mjs.
 *
 * Deliberate product decision (growth phase): `plus`/`live` are sized as a
 * generous SAFETY NET, not a cost-margin budget. The previous version of
 * this file sized them off TheOneLingo_Cost_Pricing_Calculator.xlsx to hit
 * a 50% gross margin even in the worst case, which worked out to ~11-19
 * calls/day — roughly 3-6 translations before a paying subscriber got
 * locked out. That's the wrong trade-off while the priority is acquiring
 * and retaining users: it was effectively invisible-rate-limiting the
 * people actually paying. These defaults (plus: 200, live: 400 calls/day —
 * ≈65/≈130 full translations) are sized so no real usage pattern, including
 * someone in back-to-back conversations for hours, ever reaches them; they
 * only stop a genuinely pathological case (stolen token, infinite retry
 * bug) from burning unbounded spend.
 *
 * Both are overridable via PLUS_DAILY_CALL_LIMIT / LIVE_DAILY_CALL_LIMIT
 * (see template.yaml's PlusDailyCallLimit/LiveDailyCallLimit parameters) —
 * once there's enough real ai_usage data to know actual per-user usage
 * (p50/p95/p99), tighten these with `sam deploy --parameter-overrides`,
 * no code change needed. ai_usage now records Plus/Live calls too (the
 * enforcement below no longer skips them), so that data is being collected
 * starting now rather than only once tightening becomes relevant.
 *
 * `basic` (free tier) is unchanged (20/day): it sits underneath the
 * separate trial system (trialLimits.mjs — 7 days, 10 translations/5
 * conversations) as a secondary safety net, not the primary free-tier gate.
 */
function envInt(name, fallback) {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DAILY_AI_CALL_LIMITS = {
  basic: 20,
  plus: envInt('PLUS_DAILY_CALL_LIMIT', 200),
  live: envInt('LIVE_DAILY_CALL_LIMIT', 400),
};

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

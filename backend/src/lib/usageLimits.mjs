import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../db.mjs';
import { getUserPlan } from './entitlement.mjs';

export const USAGE_TABLE = process.env.USAGE_TABLE || 'ai_usage';

/**
 * Daily AI-proxy call caps per plan — bound worst-case cost exposure (a
 * leaked token, a runaway conversation-mode retry loop, or just a heavy
 * user) on the metered OpenAI/ElevenLabs/Azure routes in aiProxy.mjs.
 *
 * `plus`/`live` are sized off TheOneLingo_Cost_Pricing_Calculator.xlsx
 * (shared alongside this change), targeting a 50% gross margin on a
 * subscriber's AI cost EVEN IN THE WORST CASE (gpt-4o + ElevenLabs v3 —
 * i.e. every call this user makes hits the priciest model/TTS combination
 * the app can route to, which real usage will rarely do every single call).
 * At ₹200/₹360 current pricing (backend/src/lib/razorpay.mjs) and the
 * calculator's usage assumptions (~8s audio, ~150+60 tokens, ~80 TTS
 * characters per transaction — 3 AI calls each: transcribe+translate+TTS):
 *   plus: ₹100/mo cost budget → ~11 calls/day (was 150 — a real cut, see below)
 *   live: ₹180/mo cost budget → ~19 calls/day (was 500)
 * This is a steep reduction from the previous placeholder values, and is a
 * genuine product trade-off, not just a bug fix: it caps a paid subscriber
 * to roughly 3-6 translations/day before hitting the daily limit. Before
 * shipping this to production, decide (with the spreadsheet's "Target gross
 * margin" and per-transaction usage assumptions as the levers) whether that
 * trade-off is right for the product, or whether it's the ₹200/₹360 pricing
 * that should move instead — both are one cell each in the calculator.
 *
 * `basic` (free tier) is deliberately left unchanged (20/day) here: it has
 * $0 revenue to size a margin against, so "how much free usage to give away"
 * is a growth/acquisition-cost decision, not a cost-recovery one — flagging
 * rather than guessing. At today's worst-case per-call cost, 20 calls/day
 * (≈6-7 free transactions/day) is a real, uncapped-by-revenue cost per free
 * user (~₹188/month in the calculator's worst case) — worth a deliberate
 * decision, not a default.
 */
export const DAILY_AI_CALL_LIMITS = { basic: 20, plus: 11, live: 19 };

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

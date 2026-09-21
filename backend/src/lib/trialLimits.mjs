import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { PLANS } from './entitlement.mjs';

/**
 * The 7-day free trial for new ('basic' plan) users: a one-time allowance of
 * 10 single translations and 5 conversations, counted from the first actual
 * use (not from sign-up) so a user who signs up and doesn't open the app
 * right away doesn't lose trial days sitting unused. Once either the day
 * window or a cap is exhausted, the client is expected to route the user to
 * the paywall (see PaywallView.tsx / components/onboarding) — this module
 * only ever answers "is this next one allowed", it doesn't know about UI.
 *
 * Deliberately independent from DAILY_AI_CALL_LIMITS (usageLimits.mjs): that
 * caps raw AI-proxy calls (transcribe/translate/TTS) per plan per day, to
 * bound worst-case API cost — a single translation alone is 2-3 of those
 * calls. This counts product-level actions (one full translation, one full
 * conversation session) against a lifetime trial allowance, which is a
 * different axis entirely. A 'basic' user is bound by both simultaneously;
 * 'plus'/'live' subscribers are exempt from this module entirely (they pay,
 * so there's no trial to run out) but still subject to their daily AI-call cap.
 */
export const TRIAL_DAYS = 7;
export const TRIAL_CAPS = { translation: 10, conversation: 5 };

const COUNTER_FIELD = {
  translation: 'trial_translations_used',
  conversation: 'trial_conversations_used',
};

function daysElapsedSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000);
}

async function readPlanAndTrialFields(userId) {
  const result = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));
  const item = result.Item || {};
  const plan = PLANS.includes(item.plan) ? item.plan : 'basic';
  return { item, plan };
}

/**
 * Read-only trial status for the caller — used to render a "3/10 translations,
 * 2 days left" banner. Never starts the trial clock itself; only
 * consumeTrialUsage does that, and only when a use is actually attempted.
 */
export async function getTrialStatus(userId) {
  const { item, plan } = await readPlanAndTrialFields(userId);
  if (plan !== 'basic') return { plan, unlimited: true };

  const used = {
    translation: item.trial_translations_used || 0,
    conversation: item.trial_conversations_used || 0,
  };

  if (!item.trial_start_date) {
    return {
      plan, unlimited: false, trial_started: false, expired: false,
      caps: TRIAL_CAPS, used, days_remaining: TRIAL_DAYS,
    };
  }

  const elapsed = daysElapsedSince(item.trial_start_date);
  const expired = elapsed >= TRIAL_DAYS;
  return {
    plan, unlimited: false, trial_started: true, expired,
    trial_start_date: item.trial_start_date,
    caps: TRIAL_CAPS, used,
    days_remaining: Math.max(0, Math.ceil(TRIAL_DAYS - elapsed)),
  };
}

/**
 * Attempts to spend one unit of trial usage (`kind` is 'translation' or
 * 'conversation') and returns whether it was allowed. Starts the trial clock
 * on the very first call for a user (SET ... if_not_exists), so the 7 days
 * run from first real use rather than account creation.
 *
 * The actual increment is a conditioned ADD (ConditionExpression guards
 * against the counter having already reached its cap), so two rapid calls
 * racing each other can't both succeed and push the counter past the cap —
 * same atomic-update pattern as usageLimits.mjs's daily call counter.
 */
export async function consumeTrialUsage(userId, kind) {
  if (!COUNTER_FIELD[kind]) {
    const err = new Error(`kind must be one of: ${Object.keys(COUNTER_FIELD).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // Ensure trial_start_date exists — a no-op after the first-ever call.
  const initResult = await db.send(new UpdateCommand({
    TableName: SETTINGS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET trial_start_date = if_not_exists(trial_start_date, :now)',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
    ReturnValues: 'ALL_NEW',
  }));
  const item = initResult.Attributes || {};
  const plan = PLANS.includes(item.plan) ? item.plan : 'basic';

  // Paying subscribers aren't trial-limited — always allowed (their daily
  // AI-call cap, enforced separately in usageLimits.mjs, is the real limit).
  if (plan !== 'basic') return { allowed: true, unlimited: true };

  const elapsed = daysElapsedSince(item.trial_start_date);
  if (elapsed >= TRIAL_DAYS) {
    return { allowed: false, reason: 'trial_expired', trial_start_date: item.trial_start_date };
  }

  const field = COUNTER_FIELD[kind];
  const cap = TRIAL_CAPS[kind];
  const usedSoFar = item[field] || 0;
  if (usedSoFar >= cap) {
    return { allowed: false, reason: 'trial_limit_reached', kind, used: usedSoFar, cap };
  }

  try {
    const incResult = await db.send(new UpdateCommand({
      TableName: SETTINGS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: `ADD ${field} :one`,
      ConditionExpression: `attribute_not_exists(${field}) OR ${field} < :cap`,
      ExpressionAttributeValues: { ':one': 1, ':cap': cap },
      ReturnValues: 'UPDATED_NEW',
    }));
    const used = incResult.Attributes[field];
    return { allowed: true, kind, used, remaining: Math.max(0, cap - used), cap };
  } catch (err) {
    // Lost the race against a concurrent call that hit the cap first.
    if (err.name === 'ConditionalCheckFailedException') {
      return { allowed: false, reason: 'trial_limit_reached', kind, used: cap, cap };
    }
    throw err;
  }
}

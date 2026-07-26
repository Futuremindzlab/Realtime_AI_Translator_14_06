/**
 * Shared usage-aggregation helpers for the admin analytics routes. Both
 * adminAnalytics.mjs (per-user table) and dashboardMetrics.mjs (WAU/MAU)
 * need the same conversation_history scan + per-user last-active rollup —
 * this is the one place that logic lives.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { db, TRANSLATIONS_TABLE } from '../db.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;

export async function scanAllTranslations() {
  const items = [];
  let lastKey;
  do {
    const result = await db.send(new ScanCommand({
      TableName: TRANSLATIONS_TABLE,
      ExclusiveStartKey: lastKey,
      ProjectionExpression: 'user_id, #ts, source_language, target_language, conversation_mode, created_at',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
    }));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Map of user_id -> { translationCount, conversationModeCount, lastActive, languagePairs }. */
export function buildUsageByUser(translations) {
  const usageByUser = new Map();
  for (const item of translations) {
    const uid = item.user_id;
    if (!uid) continue;
    if (!usageByUser.has(uid)) {
      usageByUser.set(uid, { translationCount: 0, conversationModeCount: 0, lastActive: null, languagePairs: {} });
    }
    const entry = usageByUser.get(uid);
    entry.translationCount += 1;
    if (item.conversation_mode) entry.conversationModeCount += 1;
    const ts = item.created_at || item.timestamp;
    if (ts && (!entry.lastActive || ts > entry.lastActive)) entry.lastActive = ts;
    const pair = `${item.source_language || '?'}→${item.target_language || '?'}`;
    entry.languagePairs[pair] = (entry.languagePairs[pair] || 0) + 1;
  }
  return usageByUser;
}

/** Count + % of `totalMembers` whose lastActive falls within the last `days`. */
export function countActiveWithin(usageByUser, days, totalMembers) {
  const cutoff = Date.now() - days * DAY_MS;
  let count = 0;
  for (const entry of usageByUser.values()) {
    if (entry.lastActive && new Date(entry.lastActive).getTime() >= cutoff) count += 1;
  }
  return { count, pct: totalMembers ? Math.round((count / totalMembers) * 1000) / 10 : 0 };
}

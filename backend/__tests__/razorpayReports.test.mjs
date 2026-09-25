import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

const { computeSubscriptionsOverview } = await import('../src/lib/razorpayReports.mjs');

const DAY = 24 * 60 * 60;

function sub({ id, status, plan, userId, current_end, created_at }) {
  return { id, status, notes: { user_id: userId, plan }, current_end, created_at };
}

describe('computeSubscriptionsOverview', () => {
  test('splits active-subscriber counts and MRR by plan (plus vs live)', () => {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = [
      sub({ id: 'sub_p1', status: 'active', plan: 'plus', userId: 'u1', current_end: now + 20 * DAY }),
      sub({ id: 'sub_p2', status: 'authenticated', plan: 'plus', userId: 'u2', current_end: now + 25 * DAY }),
      sub({ id: 'sub_l1', status: 'active', plan: 'live', userId: 'u3', current_end: now + 15 * DAY }),
    ];
    const result = computeSubscriptionsOverview(subscriptions, new Map());

    assert.equal(result.byPlan.plus.activeCount, 2);
    assert.equal(result.byPlan.plus.mrr, 200); // 2 x ₹100
    assert.equal(result.byPlan.live.activeCount, 1);
    assert.equal(result.byPlan.live.mrr, 200); // 1 x ₹200
  });

  test('flags an active subscription renewing within 7 days, regardless of cancellation status', () => {
    const now = Math.floor(Date.now() / 1000);
    const currentEnd = now + 3 * DAY;
    const subscriptions = [
      sub({ id: 'sub_soon', status: 'active', plan: 'plus', userId: 'u1', current_end: currentEnd }),
      sub({ id: 'sub_later', status: 'active', plan: 'plus', userId: 'u2', current_end: now + 20 * DAY }),
    ];
    const result = computeSubscriptionsOverview(subscriptions, new Map());

    assert.equal(result.expiringWithinWeek.length, 1);
    assert.equal(result.expiringWithinWeek[0].subscriptionId, 'sub_soon');
    assert.ok(result.expiringWithinWeek[0].expiresInDays <= 7);
    // The actual calendar date, not just a relative day count.
    assert.equal(result.expiringWithinWeek[0].expiresAt, new Date(currentEnd * 1000).toISOString());
  });

  test('surfaces pending/halted subscriptions as needing attention, and a human identifier when known', () => {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = [
      sub({ id: 'sub_halted', status: 'halted', plan: 'live', userId: 'u9', current_end: now + 30 * DAY }),
    ];
    const identifierMap = new Map([['u9', 'someone@example.com']]);
    const result = computeSubscriptionsOverview(subscriptions, identifierMap);

    assert.equal(result.needsAttention.length, 1);
    assert.equal(result.needsAttention[0].identifier, 'someone@example.com');
    assert.equal(result.needsAttention[0].status, 'halted');
    // A halted subscription isn't "active" — it must not count toward byPlan/MRR.
    assert.equal(result.byPlan.live.activeCount, 0);
  });

  test('ignores created/cancelled/completed subscriptions for byPlan and expiring sections', () => {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = [
      sub({ id: 'sub_created', status: 'created', plan: 'plus', userId: 'u1', current_end: now + 1 * DAY }),
      sub({ id: 'sub_cancelled', status: 'cancelled', plan: 'live', userId: 'u2', current_end: now + 1 * DAY }),
    ];
    const result = computeSubscriptionsOverview(subscriptions, new Map());

    assert.equal(result.byPlan.plus.activeCount, 0);
    assert.equal(result.byPlan.live.activeCount, 0);
    assert.equal(result.expiringWithinWeek.length, 0);
    assert.equal(result.needsAttention.length, 0);
    assert.deepEqual(result.statusBreakdown, { created: 1, cancelled: 1 });
  });

  test('counts active subscriptions expiring within 30 days, inclusive of the 7-day bucket', () => {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = [
      sub({ id: 'sub_soon', status: 'active', plan: 'plus', userId: 'u1', current_end: now + 3 * DAY }),
      sub({ id: 'sub_month', status: 'active', plan: 'plus', userId: 'u2', current_end: now + 20 * DAY }),
      sub({ id: 'sub_far', status: 'active', plan: 'plus', userId: 'u3', current_end: now + 60 * DAY }),
    ];
    const result = computeSubscriptionsOverview(subscriptions, new Map());

    // sub_soon and sub_month both fall within 30 days; sub_far doesn't.
    assert.equal(result.expiringWithinMonthCount, 2);
    // The 7-day bucket is unaffected and still only counts sub_soon.
    assert.equal(result.expiringWithinWeek.length, 1);
  });

  test('counts new subscriptions created in the last week/month regardless of current status', () => {
    const now = Math.floor(Date.now() / 1000);
    const subscriptions = [
      sub({ id: 'sub_new', status: 'active', plan: 'plus', userId: 'u1', created_at: now - 2 * DAY }),
      // Cancelled since, but still counts as an acquisition in that window.
      sub({ id: 'sub_new_cancelled', status: 'cancelled', plan: 'live', userId: 'u2', created_at: now - 5 * DAY }),
      sub({ id: 'sub_mid_month', status: 'active', plan: 'plus', userId: 'u3', created_at: now - 20 * DAY }),
      sub({ id: 'sub_old', status: 'active', plan: 'plus', userId: 'u4', created_at: now - 90 * DAY }),
    ];
    const result = computeSubscriptionsOverview(subscriptions, new Map());

    assert.equal(result.newSubscriptionsLastWeekCount, 2);
    assert.equal(result.newSubscriptionsLastMonthCount, 3);
  });
});

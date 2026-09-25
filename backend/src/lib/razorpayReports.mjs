import { razorpay, PAID_PLAN_PRICING } from './razorpay.mjs';

// Safety cap on pagination — 10 pages * 100/page = 1,000 most-recent records.
// Fine at this business's current scale (a new launch); revisit if it ever
// grows enough for "most recent 1,000 payments" to stop being "basically
// everything" — see fetchAllPayments/fetchAllSubscriptions below.
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

async function fetchAllPaginated(resource) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items } = await resource.all({ count: PAGE_SIZE, skip: page * PAGE_SIZE });
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

export function fetchAllPayments() {
  return fetchAllPaginated(razorpay.payments);
}

export function fetchAllSubscriptions() {
  return fetchAllPaginated(razorpay.subscriptions);
}

/**
 * Revenue by plan tier, from captured payments only (authorized-but-not-yet-
 * captured and failed payments aren't real revenue). Grouped by
 * `payment.notes.plan` — set once on the subscription at creation time (see
 * billing.mjs's createSubscription); Razorpay is documented to copy a
 * subscription's notes onto each auto-generated recurring-charge payment,
 * but this hasn't been confirmed against a live account in this environment
 * (no test keys available here — see RAZORPAY_INTEGRATION.md). If that
 * doesn't hold in practice, every payment falls into 'unknown' below rather
 * than being dropped or mis-totaled — verify the by-tier breakdown against
 * a real test subscription before relying on it, but the grand total is
 * correct either way since it sums every captured payment regardless of
 * whether its tier could be attributed.
 */
export function computeRevenueByTier(payments) {
  const captured = payments.filter((p) => p.status === 'captured');

  const byTierPaise = {};
  for (const p of captured) {
    const tier = p.notes?.plan || 'unknown';
    byTierPaise[tier] = (byTierPaise[tier] || 0) + p.amount;
  }

  const byTier = Object.entries(byTierPaise)
    .map(([tier, paise]) => ({ tier, total: Math.round(paise) / 100 }))
    .sort((a, b) => b.total - a.total);

  const total = Math.round(byTier.reduce((sum, t) => sum + t.total, 0) * 100) / 100;

  return { available: true, currency: 'INR', total, byTier };
}

/**
 * "Expiring soon" — a user who has requested cancellation
 * (razorpay_subscription_status === 'cancel_requested', OUR OWN status field;
 * Razorpay's own subscription.status enum has no such value, since
 * cancel_at_cycle_end doesn't change Razorpay's status until the cycle
 * actually ends — see billing.mjs's cancelSubscription) whose subscription's
 * current billing-cycle end falls within the next 7 days.
 *
 * Dashboard-only view, by design — no outbound notification is sent to
 * anyone (that scope was explicitly declined in favor of just this table).
 */
export function computeChurn(dbUsers, subscriptions, identifierMap) {
  const now = Math.floor(Date.now() / 1000);
  const subsById = new Map(subscriptions.map((s) => [s.id, s]));

  const users = dbUsers
    .filter((u) => u.razorpay_subscription_status === 'cancel_requested' && u.razorpay_subscription_id)
    .map((u) => {
      const sub = subsById.get(u.razorpay_subscription_id);
      const endsAt = sub?.current_end ?? sub?.charge_at ?? null;
      return {
        userId: u.user_id,
        identifier: identifierMap.get(u.user_id) || u.user_id,
        plan: u.plan,
        expiresInDays: endsAt !== null ? Math.max(0, Math.round((endsAt - now) / 86400)) : null,
      };
    })
    .filter((u) => u.expiresInDays !== null && u.expiresInDays <= 7)
    .sort((a, b) => a.expiresInDays - b.expiresInDays);

  return { available: true, users };
}

// A subscription counts as "active" for the byPlan/MRR/expiring-soon
// sections once its mandate is confirmed — Razorpay's own lifecycle uses
// 'authenticated' right after the first charge succeeds and 'active' from
// the second cycle on, so both are "currently paying", unlike 'created'
// (checkout not finished), 'pending'/'halted' (payment friction — surfaced
// separately in needsAttention below) or 'cancelled'/'completed'/'expired'.
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'authenticated']);

// Payment friction Razorpay is actively retrying or has given up on — these
// are the subscriptions most likely to silently lapse without anyone
// noticing, so they're surfaced regardless of how close current_end is.
const ATTENTION_STATUSES = new Set(['pending', 'halted']);

const DAY_SECONDS = 86400;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const MONTH_SECONDS = 30 * DAY_SECONDS;

/**
 * Owner-facing subscriptions overview, built entirely from Razorpay's own
 * subscription objects (each carries `notes.user_id`/`notes.plan`, set once
 * at creation by billing.mjs's createSubscription) cross-referenced only
 * with Cognito for a human-readable identifier — no DynamoDB scan needed,
 * unlike computeChurn above.
 *
 * Sections:
 *   - byPlan: active-subscriber count + MRR, split plus vs. live.
 *   - expiringWithinWeek: any ACTIVE subscription whose current billing
 *     cycle (current_end, falling back to charge_at for a subscription
 *     between cycles) ends within 7 days — renewals due soon, not just
 *     cancellations already in flight (see computeChurn for that narrower,
 *     cancel_requested-only view). Each entry carries both expiresInDays
 *     (relative, for sorting/urgency) and expiresAt (the ISO timestamp
 *     itself, for display — a day count alone doesn't say which actual
 *     date a renewal falls on).
 *   - expiringWithinMonthCount: same ACTIVE-subscription lookahead as
 *     expiringWithinWeek, just a 30-day window instead of 7 — inclusive of
 *     the week bucket (a subscription expiring in 3 days counts in both),
 *     same convention as most billing dashboards' overlapping lookahead
 *     windows. A count only, not a full list — this is a summary tile, and
 *     expiringWithinWeek already exists as the detailed table for the
 *     nearer-term, more urgent case.
 *   - newSubscriptionsLastWeekCount / newSubscriptionsLastMonthCount: every
 *     subscription (any status, not just ACTIVE — this is an acquisition
 *     metric, not a revenue one) created in the last 7/30 days, from
 *     Razorpay's own `created_at`. Also overlapping windows, same as above.
 *   - needsAttention: subscriptions Razorpay flags as pending/halted —
 *     i.e. a renewal charge is failing — regardless of how far out
 *     current_end is, since these are the ones actually at risk of lapsing.
 */
export function computeSubscriptionsOverview(subscriptions, identifierMap) {
  const now = Math.floor(Date.now() / 1000);

  const byPlan = {
    plus: { activeCount: 0, mrr: 0 },
    live: { activeCount: 0, mrr: 0 },
  };
  const statusBreakdown = {};
  const expiringWithinWeek = [];
  const needsAttention = [];
  let expiringWithinMonthCount = 0;
  let newSubscriptionsLastWeekCount = 0;
  let newSubscriptionsLastMonthCount = 0;

  for (const sub of subscriptions) {
    const plan = sub.notes?.plan;
    const status = sub.status;
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

    const identifier = identifierMap.get(sub.notes?.user_id) || sub.notes?.user_id || 'unknown';

    if (typeof sub.created_at === 'number') {
      const ageSeconds = now - sub.created_at;
      if (ageSeconds <= WEEK_SECONDS) newSubscriptionsLastWeekCount += 1;
      if (ageSeconds <= MONTH_SECONDS) newSubscriptionsLastMonthCount += 1;
    }

    if (ACTIVE_SUBSCRIPTION_STATUSES.has(status) && (plan === 'plus' || plan === 'live')) {
      byPlan[plan].activeCount += 1;
      byPlan[plan].mrr += PAID_PLAN_PRICING[plan].amountPaise / 100;

      const endsAt = sub.current_end ?? sub.charge_at ?? null;
      if (endsAt !== null) {
        const expiresInDays = Math.max(0, Math.round((endsAt - now) / 86400));
        if (expiresInDays <= 7) {
          expiringWithinWeek.push({
            userId: sub.notes?.user_id || null,
            identifier,
            plan,
            subscriptionId: sub.id,
            expiresInDays,
            expiresAt: new Date(endsAt * 1000).toISOString(),
          });
        }
        if (expiresInDays <= 30) expiringWithinMonthCount += 1;
      }
    }

    if (ATTENTION_STATUSES.has(status)) {
      needsAttention.push({
        userId: sub.notes?.user_id || null,
        identifier,
        plan: plan || 'unknown',
        subscriptionId: sub.id,
        status,
      });
    }
  }

  expiringWithinWeek.sort((a, b) => a.expiresInDays - b.expiresInDays);

  return {
    available: true,
    byPlan,
    statusBreakdown,
    expiringWithinWeek,
    expiringWithinMonthCount,
    newSubscriptionsLastWeekCount,
    newSubscriptionsLastMonthCount,
    needsAttention,
  };
}

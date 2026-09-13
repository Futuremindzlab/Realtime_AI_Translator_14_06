import { razorpay } from './razorpay.mjs';

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

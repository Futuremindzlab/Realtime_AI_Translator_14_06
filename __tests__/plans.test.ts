import { PAID_PLAN_PRICE, PLAN_INFO } from '@/lib/plans';

describe('PAID_PLAN_PRICE', () => {
  it('shows a price for both paid tiers', () => {
    expect(PAID_PLAN_PRICE.plus).toMatch(/^₹\d+\/mo$/);
    expect(PAID_PLAN_PRICE.live).toMatch(/^₹\d+\/mo$/);
  });

  it('prices Live at or above Plus — the upsell has to make sense', () => {
    const toRupees = (s: string) => Number(s.replace(/[^\d]/g, ''));
    expect(toRupees(PAID_PLAN_PRICE.live)).toBeGreaterThanOrEqual(toRupees(PAID_PLAN_PRICE.plus));
  });

  // Regression guard for exactly the bug this session hit: the pricing PR
  // (#26) was merged into `lib/plans.ts` and backend/src/lib/razorpay.mjs
  // separately, and one of the two didn't land for a while — the paywall
  // kept showing stale numbers with no test failing to say so. This can't
  // import the backend's .mjs (different module system/runtime), so it
  // pins the same literal value backend/src/lib/razorpay.mjs's own test
  // asserts — if either file changes without the other, one of these two
  // tests breaks.
  it('matches the price this session most recently agreed on (₹100 / ₹200)', () => {
    expect(PAID_PLAN_PRICE).toEqual({ plus: '₹100/mo', live: '₹200/mo' });
  });
});

describe('PLAN_INFO', () => {
  it('has display copy for all three plans', () => {
    expect(Object.keys(PLAN_INFO).sort()).toEqual(['basic', 'live', 'plus']);
    for (const plan of Object.values(PLAN_INFO)) {
      expect(plan.label.length).toBeGreaterThan(0);
      expect(plan.description.length).toBeGreaterThan(0);
    }
  });
});

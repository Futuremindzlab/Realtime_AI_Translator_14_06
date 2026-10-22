import { SubscriptionPlan } from '@/types';

/**
 * Single source of truth for plan display copy — extracted out of
 * app/(tabs)/settings.tsx so the paywall shown during onboarding and the one
 * shown when a trial limit is hit (components/onboarding/PaywallView.tsx)
 * can't drift out of sync with the Settings screen's own upgrade cards.
 */
export const PLAN_INFO: Record<SubscriptionPlan, { label: string; description: string }> = {
  basic: { label: 'Basic', description: "Today's pipeline — record, transcribe, translate, then speak." },
  plus:  { label: 'Plus',  description: 'Streaming pipeline — starts speaking the translation before it finishes generating.' },
  live:  { label: 'Live',  description: 'Everything in Plus, plus translations spoken in your own cloned voice. (Continuous live interpretation coming soon)' },
};

// Monthly price shown on upgrade buttons — informational only now that
// Google Play Billing is the purchase path (services/billingService.ts):
// the real, authoritative price is whatever's configured on the product in
// Play Console and is what Play's own purchase sheet actually shows/charges.
// Keep this in sync with Play Console manually if the price ever changes.
export const PAID_PLAN_PRICE: Record<'plus' | 'live', string> = { plus: '₹100/mo', live: '₹200/mo' };

// Play Console subscription product IDs — created once in Play Console →
// Monetize → Products → Subscriptions, must match
// GOOGLE_PLAY_PRODUCT_ID_PLUS/LIVE on the backend exactly (see
// GOOGLE_PLAY_BILLING_INTEGRATION.md). Unlike Razorpay's plan IDs, these
// aren't server-generated — you choose them when creating the product in
// Play Console, so they're a plain client-side constant, not fetched.
export const PLAY_PRODUCT_ID: Record<'plus' | 'live', string> = {
  plus: 'onelingo_plus_monthly',
  live: 'onelingo_live_monthly',
};

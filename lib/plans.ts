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
  live:  { label: 'Live',  description: 'Continuous live interpretation, no record/stop steps. (Coming soon)' },
};

// Monthly price shown on upgrade buttons — mirrors backend/src/lib/razorpay.mjs's
// PAID_PLAN_PRICING (kept as a display-only literal here; the backend is the
// only place that actually charges an amount, via the Razorpay Plan it created).
export const PAID_PLAN_PRICE: Record<'plus' | 'live', string> = { plus: '₹200/mo', live: '₹360/mo' };

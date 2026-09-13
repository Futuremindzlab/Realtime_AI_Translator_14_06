#!/usr/bin/env node
/**
 * One-time setup: creates the Razorpay recurring Plans for the 'plus' and
 * 'live' subscription tiers (see backend/src/lib/razorpay.mjs's
 * PAID_PLAN_PRICING for pricing). Razorpay Plans are immutable and have no
 * natural key to "get or create" against, so this script lists existing
 * plans first and skips creating a duplicate if one with the same name
 * already exists — safe to re-run, but NOT a way to change a price (see the
 * comment on PAID_PLAN_PRICING for why).
 *
 * Run this ONCE per Razorpay account (or once per price change), then paste
 * the printed Plan IDs into your deploy parameters
 * (RazorpayPlanIdPlus / RazorpayPlanIdLive in backend/template.yaml) —
 * nothing else in the app reads these Plan IDs except via that env var.
 *
 * Required env vars: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 *
 * Usage:
 *   cd backend && npm install
 *   RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx node scripts/setup-razorpay-plans.mjs
 */

import Razorpay from 'razorpay';

const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error('❌ RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars are required.');
  process.exit(1);
}

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

// Mirrors backend/src/lib/razorpay.mjs's PAID_PLAN_PRICING — kept as a literal
// copy here rather than imported, since this script intentionally runs
// standalone (before the Lambda env vars it produces even exist yet).
const PLANS_TO_CREATE = [
  { key: 'plus', name: 'The OneLingo — Plus (Monthly)', amount: 200 * 100 },
  { key: 'live', name: 'The OneLingo — Live (Monthly)', amount: 360 * 100 },
];

async function findExistingPlan(name) {
  // Razorpay's list endpoint is paginated (count/skip); 100 is its max page
  // size and comfortably covers "a handful of plans for one small app."
  const { items } = await razorpay.plans.all({ count: 100 });
  return items.find((p) => p.item?.name === name) || null;
}

async function main() {
  console.log(`🔌 Setting up Razorpay Plans (key: ${KEY_ID})\n`);
  const ids = {};

  for (const { key, name, amount } of PLANS_TO_CREATE) {
    const existing = await findExistingPlan(name);
    if (existing) {
      console.log(`✅ Plan already exists for '${key}': ${existing.id} (₹${amount / 100}/month) — skipping creation.`);
      ids[key] = existing.id;
      continue;
    }

    const plan = await razorpay.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name,
        amount,
        currency: 'INR',
        description: `Recurring monthly subscription — ${name}`,
      },
    });
    console.log(`✅ Created Plan for '${key}': ${plan.id} (₹${amount / 100}/month)`);
    ids[key] = plan.id;
  }

  console.log('\n📋 Set these as deploy parameters:');
  console.log(`   RazorpayPlanIdPlus=${ids.plus}`);
  console.log(`   RazorpayPlanIdLive=${ids.live}`);
  console.log('\n🎉 Done. These Plan IDs are permanent — save them (e.g. in samconfig.toml\'s parameter_overrides, or the RAZORPAY_PLAN_ID_* GitHub secrets).');
}

main().catch((err) => {
  console.error('\n❌ setup-razorpay-plans failed:', err);
  process.exit(1);
});

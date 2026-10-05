# Legal pages — draft

The actual page now lives at `website/legal/policies.html`, not here — moved
so Netlify's existing `theonelingo` site (see `netlify.toml`, `base =
"website"`) picks it up and serves it automatically at
`https://theonelingo.com/legal/policies.html` on the next deploy, same as
every other page under `website/`. This file stays only as the design notes
below.

`policies.html` is a single self-contained page covering the Privacy Policy, Terms of Service, and Refund/Cancellation Policy for The OneLingo (formerly referred to internally as Realtime AI Translator). Everything in it is grounded in what the app actually does (see the code it's based on — the retention sweep, `settings.mjs`'s `plan`/`razorpay_subscription_*` fields, `billing.mjs`'s cancel-at-cycle-end behavior, the third-party processors actually wired up).

**Filled in so far** (from business details provided 2026-09-13, grievance officer's address added 2026-10-05):
- Legal/business name: Futureminds Lab LLP
- App/brand name throughout: The OneLingo
- Support email: Admin@futuremindzlab.com
- Grievance officer: Bharathi Subramaniyam, Bhrathi@futuremindzlab.com, PL No.77, JBR Tech Park, 6th Road, EPIP Zone, Whitefield, Bangalore South, Bangalore - 560066, Karnataka, India
- AWS processing region: us-east-1 (N. Virginia, USA)
- Effective date: 13 Sep 2026 (placeholder default — change to your actual publish/launch date if different)

No placeholders left open as of 2026-10-05 — the page is ready to go live as-is. Still worth a final look before publishing:
- Confirm the refund stance in §3 of the Refund Policy — as written it matches exactly what the cancel-subscription code does (cancel-at-cycle-end, no proration, 30-day error-report window, 5–7 business day refund turnaround), not a made-up policy. Change the code and this page together if you want different terms.

**Where this lives:**
- Live draft: see the Artifact link shared in chat — edit there and republish, or edit this file and ask for a republish.
- This file — same content, version-controlled, ready to self-host (GitHub Pages, your own domain, etc.) once finalized. Whichever URL you settle on, that's what goes into the Play Store listing, the app's Settings screen, and Razorpay's merchant profile.

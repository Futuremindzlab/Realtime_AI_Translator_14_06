# theonelingo.com — marketing homepage

A single static page (no build step, no server) — `index.html` + one image in `images/`.
This is the same page previously shared as a Claude Artifact, wrapped into a standalone
HTML document so it can be hosted anywhere as plain static files.

## What's still a placeholder

- **Waitlist form** (`#waitlistForm` in `index.html`) only validates and shows a success
  message client-side — it does not send the email anywhere yet. Wire it to a real
  endpoint (e.g. a new unauthenticated `POST /v1/waitlist` route on the existing AWS
  backend, following the same pattern as `phoneAuth.mjs`) before relying on it to
  actually collect signups.
- **Privacy Policy / Terms of Service** links point at the Claude Artifact draft
  (`https://claude.ai/code/artifact/38531f73-.../#privacy` etc.) — swap these for
  `/legal/policies.html` (or wherever you end up hosting that page) once it's finalized
  and live on your own domain.
- No pricing is shown anywhere on the page yet, by design — add a Pricing section
  once Plus/Live pricing is confirmed.

## Hosting this at theonelingo.com

This is a plain static site — any static host works (S3+CloudFront, Cloudflare Pages,
Netlify, Vercel, GitHub Pages, etc.). See the chat for the specific steps chosen for
your setup and registrar.

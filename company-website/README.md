# futuremindzlab.com — company homepage

Single static page (no build step, no server) for FUTUREMINDS LAB LLP's company website,
separate from the `website/` folder (which hosts the theonelingo.com product marketing page).

- `index.html` — the full page (self-contained, inline CSS)
- `images/` — logo mark (icon + horizontal lockup), SVG and PNG

## What's still a placeholder

- Contact form section is static copy only — no backend wired up yet.
- Privacy Policy / Terms of Service footer links (`#privacy`, `#terms`) are anchors only.

## Hosting this at futuremindzlab.com

Plain static site — deploy `index.html` (and `images/`) to any static host
(Netlify, Vercel, Cloudflare Pages, S3+CloudFront, GitHub Pages, etc.), then point
the domain's DNS at that host. See project chat for the Netlify + GoDaddy specific steps.

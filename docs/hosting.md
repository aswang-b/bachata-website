# Hosting runbook (Netlify / Vercel Hobby)

The same `main` branch builds on both hosts. `astro.config.mjs` uses the Vercel adapter when `VERCEL` is set (Vercel builds) and the Netlify adapter otherwise. Only one host serves `dancewithb.fun` at a time; DNS (Cloudflare CNAMEs for the apex and `www`) decides which.

Files each host reads: Netlify → `netlify.toml`, `public/_headers`. Vercel → `vercel.json`. They don't conflict.

## Environment variables (enter in BOTH dashboards, keep in sync)

**Server / runtime**

| Name | Notes |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | required |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Calendar OAuth |
| `GOOGLE_CALENDAR_ID_PUBLIC`, `GOOGLE_CALENDAR_ID_PRIVATE` | required |
| `ADMIN_EMAIL` | comma-separated admin emails |
| `RESEND_API_KEY`, `NOTIFICATION_EMAILS` | email |
| `CRON_SECRET` | shared secret for `/api/cron/calendar-sync`; same value as the Worker's secret |
| `RESEND_DAILY_CAP`, `RESEND_CONFIRMATION_DAILY_CAP` (registration confirmations, default 100, separate from admin notifications), `CHECKIN_DAILY_CAP_PER_IP`, `MAPS_AUTOCOMPLETE_DAILY_CAP` | optional caps |

**Build time** (inlined by Vite, must exist when the site builds)

`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_GOOGLE_MAPS_API_KEY`

Vercel: also set the project's Node.js version to 22.x.

## Calendar sync schedule

Vercel Hobby crons only run once a day, so the 15-minute schedule lives in a Cloudflare Worker (`workers/cron-scheduler/`) that POSTs `/api/cron/calendar-sync` with `Authorization: Bearer <CRON_SECRET>`. It works on whichever host serves the domain.

Set up (once):
1. Add `CRON_SECRET` (a long random string) to the live host's env vars and redeploy.
2. `cd workers/cron-scheduler`, `npx wrangler login`, `npx wrangler secret put CRON_SECRET` (same value), `npx wrangler deploy`.
3. Confirm in the Cloudflare dashboard that invocations succeed and the calendar keeps syncing.
4. Only then delete `netlify/functions/scheduled-calendar-sync.mts` and deploy Netlify once more. A stopped-builds Netlify site keeps running whatever schedule was in its last deploy, so the old function must be gone first.

## Cutover: Netlify → Vercel

1. Import the repo in Vercel (Hobby), add all env vars, deploy; test on the `*.vercel.app` URL (registration, admin login, calendar, emails).
2. Add `dancewithb.fun` and `www` to the Vercel project; let it verify.
3. In Cloudflare DNS (DNS-only records), point the apex and `www` CNAMEs at Vercel's targets.
4. Netlify: Project configuration → Build & deploy → **Stop or activate builds** → stop. (Don't use "lock publishing"; builds would still run.) Turn off Netlify deploy previews.

## Failover: Vercel → Netlify

1. Netlify: reactivate builds and trigger a deploy of `main`.
2. Point the Cloudflare CNAMEs back at Netlify.

## Credit notes

- Netlify Free is a 300-credit/month hard limit; a production deploy costs 15 credits, so batch pushes while Netlify is the live host and stop builds while it is only a standby.
- Vercel Hobby limits: 100 GB bandwidth, 1M function invocations, 4 active CPU-hours, 100 deploys/day. Runtime logs are kept for only 1 hour.
- Vercel's terms restrict Hobby to non-commercial use (payment-taking sites count as commercial). Accepted risk; Cloudflare Workers Paid is the fallback.

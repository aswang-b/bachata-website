import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../lib/env';
import { runCalendarSync } from '../../../lib/calendarSync';

export const prerender = false;

// Host-neutral entry point for the scheduled calendar sync. The schedule
// itself lives outside the host (workers/cron-scheduler), so this works the
// same on Netlify and on Vercel Hobby, whose own crons only run once a day.
function isAuthorized(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret) {
    console.warn('Calendar cron rejected: CRON_SECRET is not configured on this host.');
    return false;
  }

  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401 });
  }

  try {
    const result = await runCalendarSync();
    console.log('Scheduled calendar sync completed:', result);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error('Scheduled calendar sync failed:', err);
    const message = err instanceof Error ? err.message : 'Sync failed.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { runCalendarSync } from '../../../lib/calendarSync';
import { GoogleAuthExpiredError } from '../../../lib/googleCalendar';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  try {
    const result = await runCalendarSync();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    if (err instanceof GoogleAuthExpiredError) {
      console.error('Calendar sync failed: every stored Google token is expired or revoked.');
      return new Response(JSON.stringify({ error: err.message }), { status: 401 });
    }
    console.error('Calendar sync failed:', err);
    const message = err instanceof Error ? err.message : 'Sync failed.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

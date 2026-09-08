import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { runCalendarSync } from '../../../lib/calendarSync';

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
    console.error('Calendar sync failed:', err);
    const message = err instanceof Error ? err.message : 'Sync failed.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

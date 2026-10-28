import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { allVisibilities } from '../../../lib/testMode';
import { requireAdmin } from '../../../lib/admin';
import { buildClassSeriesList, siteDayBoundsUtcIso } from '../../../lib/classSeries';

export const prerender = false;

// Today's midnight in the site's time zone.
function siteMidnightUtcIso(): string {
  return siteDayBoundsUtcIso().startIso;
}

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  // Admins may want a QR code for a class that isn't public yet, so this
  // intentionally isn't filtered to visibility: 'public' like check-in.astro's
  // own picker is — otherwise a private class could never get a check-in QR.
  const { data: classEvents, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, google_recurring_event_id, price_drop_in, registration_closed')
    .in('visibility', allVisibilities())
    .eq('event_type', 'class')
    .gte('start_time', siteMidnightUtcIso())
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Failed to load classes for check-in QR generator:', error);
    return new Response(JSON.stringify({ error: 'Failed to load classes.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ classSeries: buildClassSeriesList(classEvents ?? []) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { buildClassSeriesList, TIME_ZONE } from '../../../lib/classSeries';

export const prerender = false;

function chicagoMidnightUtcIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'shortOffset',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetName = get('timeZoneName');
  const offsetHours = parseInt(offsetName.replace('GMT', ''), 10) || 0;
  const offsetStr = `${offsetHours <= 0 ? '-' : '+'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`;
  return `${get('year')}-${get('month')}-${get('day')}T00:00:00${offsetStr}`;
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
    .select('id, title, start_time, end_time, google_recurring_event_id')
    .eq('event_type', 'class')
    .gte('start_time', chicagoMidnightUtcIso())
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

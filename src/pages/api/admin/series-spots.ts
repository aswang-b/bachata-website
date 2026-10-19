import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { getSpotsByOccurrence, seriesKeyOf, seriesSpots, spotsLabel } from '../../../lib/capacity';

export const prerender = false;

// Spots remaining per upcoming class/event series that has a capacity,
// including ones whose count is hidden from the public — for the admin view
// of the homepage cards. `label` reads like "5 spots remaining" or, for a
// class capped by role, "3 leader spots left · Followers full".
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const { data, error } = await supabase
    .from('events')
    .select('id, google_recurring_event_id, capacity, show_capacity, capacity_by_role, leader_capacity, follower_capacity')
    .or('capacity.not.is.null,capacity_by_role.eq.true')
    .gte('start_time', new Date().toISOString());
  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load capacities.' }), { status: 500 });
  }

  let spots;
  try {
    spots = await getSpotsByOccurrence(data ?? []);
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to count registrations.' }), { status: 500 });
  }

  const idsByKey = new Map<string, { ids: string[]; shown: boolean }>();
  for (const e of data ?? []) {
    const entry = idsByKey.get(seriesKeyOf(e)) ?? { ids: [] as string[], shown: e.show_capacity };
    entry.ids.push(e.id);
    idsByKey.set(seriesKeyOf(e), entry);
  }
  const series: Record<string, { label: string; full: boolean; shown: boolean }> = {};
  for (const [key, { ids, shown }] of idsByKey) {
    const s = seriesSpots(spots, ids);
    if (s) series[key] = { label: spotsLabel(s), full: s.full, shown };
  }

  return new Response(JSON.stringify({ series }), { status: 200 });
};

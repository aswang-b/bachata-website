import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { getSpotsByOccurrence, spotsLabel, type CapacityEventRow, type SpotsInfo } from '../../../lib/capacity';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  // Supabase caps a single response at 1000 rows, so page through the table —
  // otherwise the newest/upcoming events silently drop off once past
  // occurrences pile up. `id` breaks start_time ties so pages never overlap.
  const PAGE_SIZE = 1000;
  const events: (CapacityEventRow & Record<string, unknown>)[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('events')
      .select(
        'id, title, description, location, event_type, color, visibility, start_time, end_time, google_recurring_event_id, price_whole_series, price_drop_in, price_student, image_url, flyer_url, registration_closed, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until, lesson_overview_title, lesson_overview_body, hide_lesson_overview, capacity, show_capacity, capacity_by_role, leader_capacity, follower_capacity, updated_at'
      )
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return new Response(JSON.stringify({ error: 'Failed to load events.' }), { status: 500 });
    }
    events.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  // Admins see spots remaining even when it's hidden from the public — on
  // classes that haven't ended, since no one can sign up for the rest (and
  // counting the whole history took a query per 150 past events).
  const now = Date.now();
  let spots = new Map<string, SpotsInfo>();
  try {
    spots = await getSpotsByOccurrence(events.filter((e) => Date.parse(String(e.end_time)) >= now));
  } catch {
    // Leave spots out rather than failing the whole calendar.
  }
  const withSpots = events.map((e) => ({
    ...e,
    spots_label: spots.has(e.id) ? spotsLabel(spots.get(e.id)!) : null,
    spots_admin_only: !e.show_capacity,
  }));

  return new Response(JSON.stringify({ events: withSpots }), { status: 200 });
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const { data: events, error } = await supabase
    .from('events')
    .select(
      'id, title, description, location, event_type, color, visibility, start_time, end_time, google_recurring_event_id, price_whole_series, price_drop_in, price_student, image_url, registration_closed, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until'
    )
    .order('start_time', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load events.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ events: events ?? [] }), { status: 200 });
};

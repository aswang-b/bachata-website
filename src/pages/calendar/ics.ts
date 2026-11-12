import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { publicVisibilities } from '../../lib/testMode';
import { loadSiteLocation } from '../../lib/siteConfig';
import { buildIcs, MAX_ICS_EVENTS } from '../../lib/ics';

export const prerender = false;

// GET /calendar/ics?e=<eventId>[,<eventId>…]: the "Add to calendar" file for
// those class dates. Public class details only, and only dates a signed-out
// visitor can see on /calendar (publicVisibilities), so the link carries and
// reveals nothing personal.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ url }) => {
  const raw = url.searchParams.get('e') ?? '';
  const ids = raw.split(',').map((s) => s.trim());
  if (!raw || ids.length > MAX_ICS_EVENTS || ids.some((id) => !UUID_RE.test(id))) return text(400, 'Bad calendar link.');

  const { data, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, location, city, state')
    .in('id', [...new Set(ids.map((id) => id.toLowerCase()))])
    .in('visibility', publicVisibilities())
    .order('start_time', { ascending: true });
  if (error) {
    console.error('Failed to load classes for the calendar file:', error.message);
    return text(500, 'Could not build the calendar file.');
  }
  if (!data || data.length === 0) return text(404, 'No classes found.');

  const body = buildIcs(data, await loadSiteLocation());
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dance-with-b.ics"',
      'Cache-Control': 'no-store',
    },
  });
};

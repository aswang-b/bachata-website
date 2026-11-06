import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { cleanMessage, lastSendFor, pushConfigured, PushError, recentSends, sendChunk, startSend, subscriberCounts } from '../../../lib/push';
import { fakePush, publicVisibilities } from '../../../lib/testMode';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failed = (e: unknown) => (e instanceof PushError ? json({ error: e.message }, e.status) : json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500));

const EVENT_COLUMNS = 'id, title, event_type, start_time, end_time, location, google_recurring_event_id';

// Upcoming public classes and events a notification can be about (the next 120 days), one per series.
async function upcomingEvents() {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .in('visibility', publicVisibilities())
    .gte('start_time', new Date().toISOString())
    .lte('start_time', new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString())
    .order('start_time')
    .limit(500);
  if (error) throw new PushError(`Couldn't load the classes: ${error.message}`, 500);
  const seen = new Set<string>();
  return (data ?? []).filter((e) => {
    const key = e.google_recurring_event_id ?? e.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// /admin/notifications. GET → set up or not, how many phones, upcoming
// classes/events and what was sent; GET ?event=<id> → that class or event and
// when it was last sent about.
export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    const eventId = url.searchParams.get('event');
    if (eventId) {
      const { data: event } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
      return json({ event, lastSend: await lastSendFor(eventId) });
    }
    const [subscribers, sends, events] = await Promise.all([subscriberCounts(), recentSends(), upcomingEvents()]);
    return json({ configured: pushConfigured() || fakePush(), subscribers, sends, events });
  } catch (e) {
    return failed(e);
  }
};

// POST { title, body, url, eventId?, confirmRepeat? } records a send to every
// device and sends its first chunk; POST { continue: <send id> } sends the next
// (the page keeps asking until the send's finished_at is set). About an event
// already sent about, it answers 409 { error: 'repeat', lastSend } unless confirmRepeat.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  try {
    if (typeof body?.continue === 'string') return json({ send: await sendChunk(body.continue) });
    const message = cleanMessage(body);
    const eventId = typeof body?.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(body.eventId) ? body.eventId : null;
    if (eventId && body?.confirmRepeat !== true) {
      const lastSend = await lastSendFor(eventId);
      if (lastSend) return json({ error: 'repeat', lastSend }, 409);
    }
    const send = await startSend(message, { eventId, sentBy: user.email ?? null });
    return json({ send });
  } catch (e) {
    return failed(e);
  }
};

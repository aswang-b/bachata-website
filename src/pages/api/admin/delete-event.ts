import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { getGoogleAccessToken, deleteCalendarEvent } from '../../../lib/googleCalendar';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const eventId = body?.eventId;
  const deleteSeries = Boolean(body?.deleteSeries);
  if (!eventId || typeof eventId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing eventId.' }), { status: 400 });
  }

  const { data: row, error: rowError } = await supabase
    .from('events')
    .select('id, google_event_id, google_recurring_event_id, visibility')
    .eq('id', eventId)
    .maybeSingle();

  if (rowError || !row) {
    return new Response(JSON.stringify({ error: 'Event not found.' }), { status: 404 });
  }

  if (deleteSeries && row.google_recurring_event_id) {
    // Deleting the recurring master on Google cascades to every real
    // instance. Each occurrence's own google_event_id is also deleted
    // individually as a safety net for any row that was grouped into this
    // series in our DB but isn't actually one of Google's real recurrence
    // instances (e.g. a standalone replacement event from a past repair) —
    // without this, such a row would silently survive on Google forever.
    const { data: siblings, error: siblingsError } = await supabase
      .from('events')
      .select('id, google_event_id')
      .eq('google_recurring_event_id', row.google_recurring_event_id);

    if (siblingsError) {
      return new Response(JSON.stringify({ error: 'Failed to load series.' }), { status: 500 });
    }

    try {
      const accessToken = await getGoogleAccessToken();
      await deleteCalendarEvent(accessToken, row.visibility, row.google_recurring_event_id);

      for (const sibling of siblings ?? []) {
        if (!sibling.google_event_id || sibling.google_event_id === row.google_recurring_event_id) continue;
        try {
          await deleteCalendarEvent(accessToken, row.visibility, sibling.google_event_id);
        } catch (err) {
          console.error(`Failed to delete occurrence ${sibling.id} from Google:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to delete Google Calendar series:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete series from Google.';
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }

    const { error: deleteError } = await supabase.from('events').delete().eq('google_recurring_event_id', row.google_recurring_event_id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: 'Failed to delete series.' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (row.google_event_id) {
    try {
      const accessToken = await getGoogleAccessToken();
      await deleteCalendarEvent(accessToken, row.visibility, row.google_event_id);
    } catch (err) {
      console.error('Failed to delete Google Calendar event:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete from Google.';
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
  }

  const { error: deleteError } = await supabase.from('events').delete().eq('id', row.id);
  if (deleteError) {
    return new Response(JSON.stringify({ error: 'Failed to delete event.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { ATTENDANCE_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { action, holderId, classRegistrationId, occurrenceEventId } = body ?? {};
  const holder = `${user.email}::${holderId}`;

  try {
    await requireLock(ATTENDANCE_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  // Links a check-in that auto-linking couldn't tie to a class occurrence
  // (e.g. checked in on a day the class wasn't scheduled) to a specific one.
  if (action === 'link_checkin_event') {
    const { checkinId, eventId } = body;
    if (!checkinId || !eventId) {
      return new Response(JSON.stringify({ error: 'Missing checkinId or eventId.' }), { status: 400 });
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', eventId)
      .eq('event_type', 'class')
      .maybeSingle();
    if (eventError || !event) {
      return new Response(JSON.stringify({ error: 'That class could not be found — please pick again.' }), { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from('class_checkins')
      .update({ event_id: event.id, class_title: event.title })
      .eq('id', checkinId)
      .select('id');
    if (error) return new Response(JSON.stringify({ error: 'Failed to link the check-in to that class.' }), { status: 500 });
    if (!updated || updated.length === 0) {
      return new Response(JSON.stringify({ error: 'Check-in not found.' }), { status: 404 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!classRegistrationId) {
    return new Response(JSON.stringify({ error: 'Missing classRegistrationId.' }), { status: 400 });
  }

  if (action === 'reconcile') {
    const { checkinId } = body;
    if (!checkinId) {
      return new Response(JSON.stringify({ error: 'Missing checkinId.' }), { status: 400 });
    }

    const { error } = await supabase.from('attendance_matches').insert({
      class_registration_id: classRegistrationId,
      occurrence_event_id: occurrenceEventId ?? null,
      checkin_id: checkinId,
      matched_by: user.email ?? 'unknown',
    });
    if (error) return new Response(JSON.stringify({ error: 'Failed to reconcile — that check-in may already be linked.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === 'no_show') {
    const { error } = await supabase.from('attendance_no_shows').insert({
      class_registration_id: classRegistrationId,
      occurrence_event_id: occurrenceEventId ?? null,
      marked_by: user.email ?? 'unknown',
    });
    if (error) return new Response(JSON.stringify({ error: 'Failed to mark as a no-show.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown action.' }), { status: 400 });
};

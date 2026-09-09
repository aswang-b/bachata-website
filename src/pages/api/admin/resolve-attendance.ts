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

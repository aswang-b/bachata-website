import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { ATTENDANCE_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';
import { ClassRegistrationInputError, createAdminDropInRegistration } from '../../../lib/classRegistrations';

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

  // Orphaned check-in with no sign-up: creates a Drop-In sign-up for the
  // chosen class date (re-linking the check-in to that date if it pointed
  // elsewhere) and records it as matched to this check-in.
  if (action === 'create_signup_for_checkin') {
    const { checkinId, eventId } = body;
    if (!checkinId || !eventId) {
      return new Response(JSON.stringify({ error: 'Missing checkinId or eventId.' }), { status: 400 });
    }

    const [{ data: checkin }, { data: event }, { data: existingMatch }] = await Promise.all([
      supabase.from('class_checkins').select('id, first_name, last_name, phone, email, event_id').eq('id', checkinId).maybeSingle(),
      supabase.from('events').select('id, title').eq('id', eventId).eq('event_type', 'class').maybeSingle(),
      supabase.from('attendance_matches').select('id').eq('checkin_id', checkinId).maybeSingle(),
    ]);
    if (!checkin) return new Response(JSON.stringify({ error: 'Check-in not found.' }), { status: 404 });
    if (!event) return new Response(JSON.stringify({ error: 'That class could not be found — please pick again.' }), { status: 400 });
    if (existingMatch) return new Response(JSON.stringify({ error: 'That check-in is already linked to a sign-up.' }), { status: 409 });

    if (checkin.event_id !== event.id) {
      const { error } = await supabase.from('class_checkins').update({ event_id: event.id, class_title: event.title }).eq('id', checkin.id);
      if (error) return new Response(JSON.stringify({ error: 'Failed to link the check-in to that class.' }), { status: 500 });
    }

    let registrationId: string;
    try {
      registrationId = await createAdminDropInRegistration({
        eventId: event.id,
        firstName: checkin.first_name,
        lastName: checkin.last_name,
        phone: checkin.phone || null,
        email: checkin.email || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create the sign-up.';
      return new Response(JSON.stringify({ error: message }), { status: err instanceof ClassRegistrationInputError ? 400 : 500 });
    }

    const { error } = await supabase.from('attendance_matches').insert({
      class_registration_id: registrationId,
      occurrence_event_id: event.id,
      checkin_id: checkin.id,
      matched_by: user.email ?? 'unknown',
    });
    if (error) console.error('Created a sign-up but failed to record its match:', error.message);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!classRegistrationId) {
    return new Response(JSON.stringify({ error: 'Missing classRegistrationId.' }), { status: 400 });
  }

  // Orphaned sign-up with no check-in: records a check-in for that dancer on
  // the entry's class date (or the date the admin picked, for an entry with no
  // fixed date) and links it to the entry.
  if (action === 'create_checkin_for_signup') {
    const eventId = occurrenceEventId || body.eventId;
    if (!eventId) {
      return new Response(JSON.stringify({ error: 'Pick the class date to check this dancer in to.' }), { status: 400 });
    }

    const [{ data: registration }, { data: event }] = await Promise.all([
      supabase.from('class_registrations').select('id, first_name, last_name, phone, email, class_title').eq('id', classRegistrationId).maybeSingle(),
      supabase.from('events').select('id, title').eq('id', eventId).eq('event_type', 'class').maybeSingle(),
    ]);
    if (!registration) return new Response(JSON.stringify({ error: 'Sign-up not found.' }), { status: 404 });
    if (!event || event.title !== registration.class_title) {
      return new Response(JSON.stringify({ error: 'That class date could not be found for this sign-up — please pick again.' }), { status: 400 });
    }

    const { data: checkin, error: checkinError } = await supabase
      .from('class_checkins')
      .insert({
        first_name: registration.first_name,
        last_name: registration.last_name,
        phone: registration.phone || '',
        email: registration.email || null,
        class_title: event.title,
        event_id: event.id,
      })
      .select('id')
      .single();
    if (checkinError || !checkin) return new Response(JSON.stringify({ error: 'Failed to create the check-in.' }), { status: 500 });

    const { error } = await supabase.from('attendance_matches').insert({
      class_registration_id: registration.id,
      occurrence_event_id: occurrenceEventId ?? null,
      checkin_id: checkin.id,
      matched_by: user.email ?? 'unknown',
    });
    if (error) {
      // Don't leave an unlinked duplicate behind.
      await supabase.from('class_checkins').delete().eq('id', checkin.id);
      return new Response(JSON.stringify({ error: 'Failed to link the new check-in to this sign-up.' }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

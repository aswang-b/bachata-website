import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { CHECKINS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { action, holderId } = body ?? {};
  const holder = `${user.email}::${holderId}`;

  try {
    await requireLock(CHECKINS_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  if (action === 'create') {
    const { firstName, lastName, phone, eventId } = body;
    if (!firstName || !lastName || !phone || !eventId) {
      return new Response(JSON.stringify({ error: 'First name, last name, phone, and class are required.' }), { status: 400 });
    }

    const { data: event, error: eventError } = await supabase.from('events').select('id, title').eq('id', eventId).maybeSingle();
    if (eventError || !event) {
      return new Response(JSON.stringify({ error: 'That class could not be found — please pick again.' }), { status: 400 });
    }

    const { error } = await supabase.from('class_checkins').insert({
      first_name: firstName,
      last_name: lastName,
      phone,
      class_title: event.title,
      event_id: event.id,
    });
    if (error) return new Response(JSON.stringify({ error: 'Failed to create check-in.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });
  }

  if (action === 'delete') {
    const { error } = await supabase.from('class_checkins').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: 'Failed to delete check-in.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === 'update') {
    const { firstName, lastName, phone, eventId } = body;
    if (!eventId) {
      return new Response(JSON.stringify({ error: 'A class is required.' }), { status: 400 });
    }

    const { data: event, error: eventError } = await supabase.from('events').select('id, title').eq('id', eventId).maybeSingle();
    if (eventError || !event) {
      return new Response(JSON.stringify({ error: 'That class could not be found — please pick again.' }), { status: 400 });
    }

    const { error } = await supabase
      .from('class_checkins')
      .update({ first_name: firstName, last_name: lastName, phone: phone || '', class_title: event.title, event_id: event.id })
      .eq('id', id);
    if (error) return new Response(JSON.stringify({ error: 'Failed to update check-in.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown action.' }), { status: 400 });
};

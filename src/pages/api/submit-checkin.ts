import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { env } from '../../lib/env';

export const prerender = false;

// Backstop against a scripted client flooding class_checkins with fake
// attendance from a single source; generous enough that a shared check-in
// kiosk IP (one device at the door, many students) won't hit it in a day.
const CHECKIN_DAILY_CAP_PER_IP = Number(env('CHECKIN_DAILY_CAP_PER_IP')) || 300;

export const POST: APIRoute = async ({ request, redirect, clientAddress }) => {
  const formData = await request.formData();

  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const eventId = String(formData.get('event_id') ?? '').trim();

  if (!firstName || !lastName || !phone || !eventId) {
    return new Response('Missing required fields: First Name, Last Name, Phone, and a class are required.', {
      status: 400,
    });
  }

  let ip = 'unknown';
  try {
    ip = clientAddress;
  } catch {
    // clientAddress can throw if the adapter doesn't support it — fall back
    // to a shared bucket rather than letting that crash the request.
  }

  const allowed = await checkAndIncrementUsage(`checkin:${ip}`, CHECKIN_DAILY_CAP_PER_IP);
  if (!allowed) {
    return new Response('Too many check-ins from this network today. Please ask an instructor for help.', {
      status: 429,
    });
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, title')
    .eq('id', eventId)
    .eq('visibility', 'public')
    .maybeSingle();

  if (eventError || !event) {
    return new Response('That class could not be found — please pick again.', { status: 400 });
  }

  const { data: checkin, error } = await supabase
    .from('class_checkins')
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone,
      class_title: event.title,
      event_id: event.id,
    })
    .select('id')
    .single();

  if (error || !checkin) {
    console.error('Failed to insert class check-in:', error);
    return new Response('Something went wrong checking you in. Please try again.', { status: 500 });
  }

  return redirect(`/check-in/confirmation?id=${checkin.id}`, 303);
};

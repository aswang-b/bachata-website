import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { env } from '../../lib/env';
import { getSiteSettings } from '../../lib/siteSettings';

export const prerender = false;

// Backstop against a scripted client flooding class_checkins with fake
// attendance from a single source; generous enough that a shared check-in
// kiosk IP (one device at the door, many students) won't hit it in a day.
const CHECKIN_DAILY_CAP_PER_IP = Number(env('CHECKIN_DAILY_CAP_PER_IP')) || 300;

// Sanity cap on how many classes one submission can check into at once —
// well above any real schedule, just to bound a malformed/abusive request.
const MAX_CLASSES_PER_SUBMISSION = 20;

export const POST: APIRoute = async ({ request, redirect, clientAddress }) => {
  const { disable_checkin_page: checkinDisabled } = await getSiteSettings();
  if (checkinDisabled) {
    return new Response("Check-in isn't available online right now — please check in with an instructor at class.", {
      status: 403,
    });
  }

  const formData = await request.formData();

  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const eventIds = Array.from(
    new Set(
      formData
        .getAll('event_ids')
        .map((v) => String(v).trim())
        .filter(Boolean)
    )
  );

  if (!firstName || !lastName || !phone || eventIds.length === 0) {
    return new Response('Missing required fields: First Name, Last Name, Phone, and at least one class are required.', {
      status: 400,
    });
  }

  if (eventIds.length > MAX_CLASSES_PER_SUBMISSION) {
    return new Response('Too many classes selected at once.', { status: 400 });
  }

  let ip = 'unknown';
  try {
    ip = clientAddress;
  } catch {
    // clientAddress can throw if the adapter doesn't support it — fall back
    // to a shared bucket rather than letting that crash the request.
  }

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, title')
    .in('id', eventIds)
    .eq('visibility', 'public');

  if (eventsError || !events || events.length !== eventIds.length) {
    return new Response('One or more selected classes could not be found — please pick again.', { status: 400 });
  }

  for (let i = 0; i < events.length; i++) {
    const allowed = await checkAndIncrementUsage(`checkin:${ip}`, CHECKIN_DAILY_CAP_PER_IP);
    if (!allowed) {
      return new Response('Too many check-ins from this network today. Please ask an instructor for help.', {
        status: 429,
      });
    }
  }

  const { data: checkins, error } = await supabase
    .from('class_checkins')
    .insert(
      events.map((event) => ({
        first_name: firstName,
        last_name: lastName,
        phone,
        class_title: event.title,
        event_id: event.id,
      }))
    )
    .select('id');

  if (error || !checkins || checkins.length === 0) {
    console.error('Failed to insert class check-ins:', error);
    return new Response('Something went wrong checking you in. Please try again.', { status: 500 });
  }

  return redirect(`/check-in/confirmation?ids=${checkins.map((c) => c.id).join(',')}`, 303);
};

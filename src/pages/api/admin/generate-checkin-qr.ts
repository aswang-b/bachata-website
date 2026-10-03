import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { TIME_ZONE } from '../../../lib/classSeries';
import { createCheckinRegisterToken } from '../../../lib/checkinToken';

export const prerender = false;

const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });

// A QR can cover several classes at once; a sanity cap well above any real schedule.
const MAX_EVENTS_PER_QR = 12;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  // `eventId` (one class) is still accepted alongside `eventIds` (one or more).
  const rawIds: unknown[] = Array.isArray(body?.eventIds) ? body.eventIds : body?.eventId ? [body.eventId] : [];
  const eventIds = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (eventIds.length === 0) {
    return new Response(JSON.stringify({ error: 'Pick at least one class.' }), { status: 400 });
  }
  if (eventIds.length > MAX_EVENTS_PER_QR) {
    return new Response(JSON.stringify({ error: `Pick at most ${MAX_EVENTS_PER_QR} classes for one QR code.` }), { status: 400 });
  }

  const { data: found, error: eventError } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, price_drop_in, registration_closed')
    .in('id', eventIds);

  if (eventError || !found || found.length !== eventIds.length) {
    return new Response(JSON.stringify({ error: 'One of those classes could not be found.' }), { status: 404 });
  }
  // Keep the order the admin picked them in.
  const events = eventIds.map((id) => found.find((e) => e.id === id)!);

  // "Also register attendees" only makes sense for classes with a drop-in
  // price that are open for registration (the check-in re-checks this too).
  const createRegistration = body?.createRegistration === true;
  if (createRegistration && events.some((e) => e.price_drop_in == null || e.registration_closed)) {
    return new Response(
      JSON.stringify({ error: 'Registering attendees needs a drop-in price and registration to be open for every selected class.' }),
      { status: 400 }
    );
  }

  const tokens = createRegistration ? events.map((e) => createCheckinRegisterToken(e.id)) : [];
  if (createRegistration && tokens.some((t) => !t)) {
    return new Response(JSON.stringify({ error: 'Registering attendees is unavailable: the server has no signing key.' }), {
      status: 500,
    });
  }

  const origin = new URL(request.url).origin;
  // One class keeps the original per-class link. Two or more link to the
  // general check-in page limited to those events, carrying each class's
  // signed register token as `<eventId>.<token>`.
  let checkinUrl: string;
  if (events.length === 1) {
    checkinUrl = `${origin}/check-in/${events[0].id}${tokens[0] ? `?register=${tokens[0]}` : ''}`;
  } else {
    const registerParam = createRegistration ? `&register=${events.map((e, i) => `${e.id}.${tokens[i]}`).join(',')}` : '';
    checkinUrl = `${origin}/check-in?events=${events.map((e) => e.id).join(',')}${registerParam}`;
  }

  let qrDataUrl: string;
  try {
    qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 512, margin: 2 });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate QR code.' }), { status: 500 });
  }

  const scheduleOf = (e: (typeof events)[number]) =>
    `${dateFormatter.format(new Date(e.start_time))}, ${timeFormatter.format(new Date(e.start_time))}–${timeFormatter.format(new Date(e.end_time))}`;

  const title = events.length === 1 ? events[0].title : `${events.length} classes — dancers choose`;
  const scheduleLabel =
    events.length === 1 ? scheduleOf(events[0]) : events.map((e) => `${e.title} (${scheduleOf(e)})`).join(' · ');

  return new Response(JSON.stringify({ ok: true, url: checkinUrl, qrDataUrl, title, scheduleLabel, createRegistration }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

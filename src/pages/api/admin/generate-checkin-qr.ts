import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { TIME_ZONE } from '../../../lib/classSeries';

export const prerender = false;

const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const eventId = body?.eventId;
  if (!eventId || typeof eventId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing eventId.' }), { status: 400 });
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, price_drop_in, registration_closed')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !event) {
    return new Response(JSON.stringify({ error: 'That class could not be found.' }), { status: 404 });
  }

  // "Also register attendees" only makes sense for a class with a drop-in
  // price that's open for registration (the check-in re-checks this too).
  const createRegistration = body?.createRegistration === true;
  if (createRegistration && (event.price_drop_in == null || event.registration_closed)) {
    return new Response(
      JSON.stringify({ error: 'Registering attendees needs a drop-in price and registration to be open for this class.' }),
      { status: 400 }
    );
  }

  const checkinUrl = `${new URL(request.url).origin}/check-in/${event.id}${createRegistration ? '?register=1' : ''}`;

  let qrDataUrl: string;
  try {
    qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 512, margin: 2 });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate QR code.' }), { status: 500 });
  }

  const scheduleLabel = `${dateFormatter.format(new Date(event.start_time))}, ${timeFormatter.format(new Date(event.start_time))}–${timeFormatter.format(new Date(event.end_time))}`;

  return new Response(
    JSON.stringify({ ok: true, url: checkinUrl, qrDataUrl, title: event.title, scheduleLabel, createRegistration }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

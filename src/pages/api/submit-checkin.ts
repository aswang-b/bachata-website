import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { getCheckinPerIpCap } from '../../lib/notificationSettings';
import { getSiteSettings } from '../../lib/siteSettings';
import { chicagoDayBoundsUtcIso } from '../../lib/classSeries';

export const prerender = false;

// Sanity cap on how many classes one submission can check into at once —
// well above any real schedule, just to bound a malformed/abusive request.
const MAX_CLASSES_PER_SUBMISSION = 20;

// A series key is `google_recurring_event_id ?? id` — the former is a
// Google-assigned string, never a UUID, so an `id.eq.<key>` comparison
// must only be attempted when `key` actually looks like one; otherwise
// Postgres throws a type error on the whole query (uuid columns reject
// non-UUID literals outright) rather than just finding no match.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Two ways a check-in can name a class: a direct, specific occurrence's
  // event id (the admin-generated per-class QR at /check-in/[eventId], always
  // exact regardless of when it's scanned), or a series/workshop key that
  // needs resolving to whichever of its occurrences falls on today (the
  // general /check-in page's class picker).
  const directEventIds = Array.from(
    new Set(
      formData
        .getAll('event_ids')
        .map((v) => String(v).trim())
        .filter(Boolean)
    )
  );
  const seriesKeys = Array.from(
    new Set(
      formData
        .getAll('series_keys')
        .map((v) => String(v).trim())
        .filter(Boolean)
    )
  );

  if (!firstName || !lastName || !phone || (directEventIds.length === 0 && seriesKeys.length === 0)) {
    return new Response('Missing required fields: First Name, Last Name, Phone, and at least one class are required.', {
      status: 400,
    });
  }

  if (directEventIds.length + seriesKeys.length > MAX_CLASSES_PER_SUBMISSION) {
    return new Response('Too many classes selected at once.', { status: 400 });
  }

  const resolvedEvents: { id: string; title: string }[] = [];

  if (directEventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title')
      .in('id', directEventIds)
      .eq('visibility', 'public');

    if (eventsError || !events || events.length !== directEventIds.length) {
      return new Response('One or more selected classes could not be found — please pick again.', { status: 400 });
    }
    resolvedEvents.push(...events);
  }

  if (seriesKeys.length > 0) {
    const { startIso, endIso } = chicagoDayBoundsUtcIso();

    for (const key of seriesKeys) {
      // Keys are interpolated into a PostgREST .or() string, so reject anything that could add conditions.
      if (!/^[A-Za-z0-9_-]+$/.test(key)) {
        return new Response("One of your selected classes isn't scheduled today — please ask an instructor for help.", { status: 400 });
      }
      const keyFilter = UUID_RE.test(key) ? `google_recurring_event_id.eq.${key},id.eq.${key}` : `google_recurring_event_id.eq.${key}`;
      const { data: matches, error: matchError } = await supabase
        .from('events')
        .select('id, title')
        .or(keyFilter)
        .eq('visibility', 'public')
        .eq('event_type', 'class')
        .gte('start_time', startIso)
        .lt('start_time', endIso)
        .order('start_time', { ascending: true });

      if (matchError || !matches || matches.length === 0) {
        return new Response("One of your selected classes isn't scheduled today — please ask an instructor for help.", { status: 400 });
      }
      resolvedEvents.push(matches[0]);
    }
  }

  // A direct event id and a series key can resolve to the same occurrence.
  const uniqueEvents = Array.from(new Map(resolvedEvents.map((e) => [e.id, e])).values());
  resolvedEvents.splice(0, resolvedEvents.length, ...uniqueEvents);

  let ip = 'unknown';
  try {
    ip = clientAddress;
  } catch {
    // clientAddress can throw if the adapter doesn't support it — fall back
    // to a shared bucket rather than letting that crash the request.
  }

  // Backstop against a scripted client flooding class_checkins with fake
  // attendance from one source. Admin-editable and generous by default so a
  // shared check-in kiosk IP (many students, one device) won't hit it in a day.
  const dailyCapPerIp = await getCheckinPerIpCap();
  for (let i = 0; i < resolvedEvents.length; i++) {
    const allowed = await checkAndIncrementUsage(`checkin:${ip}`, dailyCapPerIp);
    if (!allowed) {
      return new Response('Too many check-ins from this network today. Please ask an instructor for help.', {
        status: 429,
      });
    }
  }

  const { data: checkins, error } = await supabase
    .from('class_checkins')
    .insert(
      resolvedEvents.map((event) => ({
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

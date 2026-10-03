import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { createCheckinDropInRegistration } from '../../lib/classRegistrations';
import { getCheckinPerIpCap } from '../../lib/notificationSettings';
import { getSiteSettings } from '../../lib/siteSettings';
import { chicagoDayBoundsUtcIso } from '../../lib/classSeries';
import { verifyCheckinRegisterToken } from '../../lib/checkinToken';

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

  // `id` is null for a check-in on a series with no occurrence today; it's
  // stored by class title only, the confirmation page tells the person to
  // double-check their selection, and the admin links it to a class from the
  // Attendance tab.
  const resolvedEvents: { id: string | null; title: string }[] = [];

  if (directEventIds.length > 0) {
    // Not limited to public events: an admin-generated QR is the one way to
    // check in to a private class (the general /check-in picker only lists
    // public ones). Still limited to classes, so a non-class event id (e.g.
    // from the calendar) can't be checked into.
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title')
      .eq('event_type', 'class')
      .in('id', directEventIds);

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

      if (matchError || !matches) {
        console.error('Failed to resolve check-in class for series key:', matchError);
        return new Response('Something went wrong checking you in. Please try again.', { status: 500 });
      }

      if (matches.length > 0) {
        resolvedEvents.push(matches[0]);
        continue;
      }

      // No occurrence today (wrong day, or the class was moved) — don't turn
      // the person away. Record the check-in against the class title alone;
      // the confirmation page asks them to double-check their selection.
      const { data: anyOccurrence, error: titleError } = await supabase
        .from('events')
        .select('title')
        .or(keyFilter)
        .eq('visibility', 'public')
        .eq('event_type', 'class')
        .order('start_time', { ascending: true })
        .limit(1);

      if (titleError || !anyOccurrence || anyOccurrence.length === 0) {
        // Not a class we know about at all (stale or tampered key) — nothing to record.
        return new Response('One of your selected classes could not be found — please pick again.', { status: 400 });
      }
      resolvedEvents.push({ id: null, title: anyOccurrence[0].title });
    }
  }

  // A direct event id and a series key can resolve to the same occurrence;
  // title-only check-ins (null id) are kept as-is, one per series.
  const seenIds = new Set<string>();
  const uniqueEvents = resolvedEvents.filter((e) => {
    if (e.id === null) return true;
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });
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

  // The admin QR's "also register" option (drop-in-only events): give each
  // QR-checked-in attendee a matching registration so they don't end up as
  // orphaned check-ins. Only honored for QR (direct event id) check-ins, and
  // never allowed to fail the check-in itself.
  // Each token is signed per event, so it only unlocks the event the admin's QR
  // was generated for. A multi-class QR carries one per class; only the classes
  // the dancer actually picked (directEventIds) are ever considered.
  const registerTokens = formData
    .getAll('register_token')
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, MAX_CLASSES_PER_SUBMISSION);
  if (registerTokens.length > 0) {
    for (const eventId of directEventIds) {
      if (!registerTokens.some((token) => verifyCheckinRegisterToken(eventId, token))) continue;
      try {
        await createCheckinDropInRegistration({ eventId, firstName, lastName, phone });
      } catch (err) {
        console.error('Failed to create a registration for a check-in:', err);
      }
    }
  }

  return redirect(`/check-in/confirmation?ids=${checkins.map((c) => c.id).join(',')}`, 303);
};

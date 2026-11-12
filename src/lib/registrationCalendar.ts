import { supabase } from './supabase';
import { publicVisibilities } from './testMode';
import { calendarLinkPath, MAX_ICS_EVENTS } from './ics';
import { SITE_URL } from './seoSchema';
import type { ClassRegistrationRow } from './classRegistrations';

// The "Add to calendar" link for a sign-up: /calendar/ics with the ids of the
// upcoming class dates it covers. A Whole Series covers every date of the
// series (series_key is the recurring id, or the class's own id for a single
// class); a Drop In covers the one date chosen. Only dates the public calendar
// shows (the same visibility rule the file's route applies), so the link never
// promises a date the file would leave out. Ids only: no personal details.

// The saved rows carry series_key (the select is *), though the shared row type does not list it.
type SavedRow = ClassRegistrationRow & { series_key?: string | null; deleted_at?: string | null };

const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;
// events.id is a uuid column: a recurring id (a Google id) in an id filter is a database error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function upcomingCalendarEventIds(registrations: ClassRegistrationRow[], now: Date = new Date()): Promise<string[]> {
  const live = (registrations as SavedRow[]).filter((r) => !r.deleted_at);
  const dropInIds = new Set<string>();
  const seriesKeys = new Set<string>();
  for (const r of live) {
    if (r.series_mode === 'dropin' || (r.series_mode == null && r.occurrence_event_id)) {
      if (r.occurrence_event_id) dropInIds.add(r.occurrence_event_id);
    } else if (r.series_key && SAFE_KEY_RE.test(r.series_key)) {
      seriesKeys.add(r.series_key);
    }
  }
  const ids = [...dropInIds].filter((k) => UUID_RE.test(k));
  const keys = [...seriesKeys];
  const keyIds = keys.filter((k) => UUID_RE.test(k));

  const base = () =>
    supabase
      .from('events')
      .select('id, start_time')
      .in('visibility', publicVisibilities())
      .gte('start_time', now.toISOString());
  const results = await Promise.all([
    ids.length > 0 ? base().in('id', ids) : null,
    keyIds.length > 0 ? base().in('id', keyIds) : null,
    keys.length > 0 ? base().in('google_recurring_event_id', keys) : null,
  ]);

  const found = new Map<string, string>();
  for (const res of results) {
    if (!res) continue;
    if (res.error) {
      console.error('Failed to load class dates for the calendar link:', res.error.message);
      continue;
    }
    for (const e of res.data ?? []) found.set(e.id as string, e.start_time as string);
  }
  return [...found.entries()]
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .slice(0, MAX_ICS_EVENTS)
    .map(([id]) => id);
}

// Path for the page, absolute URL for an email; null with no upcoming date.
export async function registrationCalendarLink(registrations: ClassRegistrationRow[], now: Date = new Date()): Promise<{ path: string; url: string } | null> {
  const path = calendarLinkPath(await upcomingCalendarEventIds(registrations, now));
  return path ? { path, url: `${SITE_URL}${path}` } : null;
}

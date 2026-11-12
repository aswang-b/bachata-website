import { supabase } from './supabase';
import { publicVisibilities } from './testMode';
import { eventDate, eventSchedule } from './eventClock';
import { validSpotId } from './askAboutSpot';

// The class behind /contact?spot=<id> (askAboutSpot.ts): looked up here, on
// the server, from the id alone, so nothing about the class is ever taken from
// the browser. Public classes only (what a signed-out visitor sees on the
// calendar), and only ones still to come.

export interface SpotClass {
  title: string;
  // "Tuesday, November 4, 7:00 PM–8:00 PM", in the class's own zone (plus its zone label off the site's clock).
  schedule: string;
  // "Nov 4", in the class's own zone.
  date: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, title, start_time, end_time, time_zone';

interface Row {
  title: string;
  start_time: string;
  end_time: string | null;
  time_zone: string | null;
}

function toSpotClass(row: Row): SpotClass {
  return {
    title: row.title,
    schedule: eventSchedule(row, { weekday: 'long', month: 'long', day: 'numeric' }),
    date: eventDate(row, { month: 'short', day: 'numeric' }),
  };
}

// A one-off class by its id, or a series by its key (the next class still to
// come). null for anything that isn't a public, upcoming class: a malformed or
// unknown id, a private or draft class, one that has started, a failed lookup.
export async function findSpotClass(raw: unknown, now: Date = new Date()): Promise<SpotClass | null> {
  if (!validSpotId(raw)) return null;
  const upcoming = now.toISOString();
  const visible = publicVisibilities();
  const types = ['class', 'event'];

  if (UUID_RE.test(raw)) {
    const { data, error } = await supabase
      .from('events')
      .select(COLUMNS)
      .eq('id', raw.toLowerCase())
      .in('visibility', visible)
      .in('event_type', types)
      .gt('start_time', upcoming)
      .maybeSingle();
    if (error) console.error('Failed to look up a class for a spot request:', error.message);
    if (data) return toSpotClass(data as Row);
  }

  const { data, error } = await supabase
    .from('events')
    .select(COLUMNS)
    .eq('google_recurring_event_id', raw)
    .in('visibility', visible)
    .in('event_type', types)
    .gt('start_time', upcoming)
    .order('start_time', { ascending: true })
    .limit(1);
  if (error) console.error('Failed to look up a series for a spot request:', error.message);
  return data?.[0] ? toSpotClass(data[0] as Row) : null;
}

// The line above the Contact form.
export function spotLine(c: SpotClass): string {
  return `Asking about a spot in ${c.title} · ${c.schedule}`;
}

// What the message field starts with (the dancer can edit it).
export function spotPrefill(c: SpotClass): string {
  return `I'd like to ask about a spot in ${c.title} (${c.date}).`;
}

// Put in front of the saved message, so the inbox shows which class it is about.
export function spotMessagePrefix(c: SpotClass): string {
  return `[Spot request: ${c.title}, ${c.date}]`;
}

export function withSpotPrefix(message: string, c: SpotClass): string {
  return message ? `${spotMessagePrefix(c)}\n${message}` : spotMessagePrefix(c);
}

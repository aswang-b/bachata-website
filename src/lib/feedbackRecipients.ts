import { supabase } from './supabase';
import { allVisibilities, hideTestRows } from './testMode';
import { buildClassSeriesList, type ClassOccurrenceRow, type ClassSeriesEntry } from './classSeries';
import { siteFormatter } from './siteTime';
import {
  expandRegistrationsToEntries,
  matchAttendance,
  type AttendanceCheckinRow,
  type AttendanceRegistrationRow,
} from './attendanceMatching';
import { dedupeRecipients, type FeedbackRecipient } from './feedback';

// What a feedback campaign can ask about, and who it asks: for a class, the
// dancers who came (its check-ins, with the email from their sign-up when the
// check-in has none); for an event, which has no check-in, everyone signed up.
// A request can also go out with only its shared link, so classes that have
// happened are listed even with nobody checked in.

export type FeedbackScope = 'occurrence' | 'series' | 'event' | 'general';

export interface FeedbackTarget {
  scope: FeedbackScope;
  seriesKey: string;
  // The occurrence (scope 'occurrence') or the event's first date.
  eventId: string | null;
}

export interface FeedbackOption extends FeedbackTarget {
  classTitle: string;
  // "Bachata Foundations · Oct 28", also the campaign's title.
  title: string;
  startTime: string;
  // Check-ins (a class) or sign-ups (an event), before merging repeats.
  people: number;
}

const ROW_LIMIT = 10000;
const MAX_OPTIONS = 300;
const day = () => siteFormatter({ month: 'short', day: 'numeric' });

async function loadSeries(eventType: 'class' | 'event'): Promise<ClassSeriesEntry[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, google_recurring_event_id, event_type')
    .in('visibility', allVisibilities())
    .eq('event_type', eventType)
    .order('start_time', { ascending: true });
  if (error) throw new Error(`Couldn't load the ${eventType}es: ${error.message}`);
  return buildClassSeriesList((data ?? []) as ClassOccurrenceRow[]);
}

export async function feedbackOptions(): Promise<FeedbackOption[]> {
  const [classes, events, checkins, signups] = await Promise.all([
    loadSeries('class'),
    loadSeries('event'),
    hideTestRows(supabase.from('class_checkins').select('event_id')).is('deleted_at', null).limit(ROW_LIMIT),
    hideTestRows(supabase.from('class_registrations').select('series_key')).is('deleted_at', null).limit(ROW_LIMIT),
  ]);
  if (checkins.error || signups.error) throw new Error("Couldn't count who came.");
  const countBy = (values: (string | null)[]) => values.reduce((m, v) => (v ? m.set(v, (m.get(v) ?? 0) + 1) : m), new Map<string, number>());
  const checkinsByEvent = countBy((checkins.data ?? []).map((c) => c.event_id as string | null));
  const signupsBySeries = countBy((signups.data ?? []).map((r) => r.series_key as string | null));

  const now = new Date();
  const hasHappened = (startTime: string) => new Date(startTime) <= now;
  const options: FeedbackOption[] = [];
  for (const s of classes) {
    const came = s.occurrences.filter((o) => checkinsByEvent.has(o.id) || hasHappened(o.startTime));
    for (const o of came) {
      const title = `${s.title} · ${day().format(new Date(o.startTime))}`;
      options.push({ scope: 'occurrence', seriesKey: s.key, eventId: o.id, classTitle: s.title, title, startTime: o.startTime, people: checkinsByEvent.get(o.id) ?? 0 });
    }
    if (s.isSeries && came.length > 0) {
      const first = s.occurrences[0].startTime;
      const last = s.occurrences[s.occurrences.length - 1].startTime;
      options.push({
        scope: 'series',
        seriesKey: s.key,
        eventId: null,
        classTitle: s.title,
        title: `${s.title} · ${day().format(new Date(first))}–${day().format(new Date(last))}`,
        startTime: came[came.length - 1].startTime,
        people: came.reduce((n, o) => n + (checkinsByEvent.get(o.id) ?? 0), 0),
      });
    }
  }
  for (const e of events) {
    const people = signupsBySeries.get(e.key) ?? 0;
    const start = e.occurrences[0].startTime;
    if (!people && !hasHappened(start)) continue;
    options.push({ scope: 'event', seriesKey: e.key, eventId: e.occurrences[0].id, classTitle: e.title, title: `${e.title} · ${day().format(new Date(start))}`, startTime: start, people });
  }
  return options.sort((a, b) => b.startTime.localeCompare(a.startTime) || Number(b.scope === 'series') - Number(a.scope === 'series')).slice(0, MAX_OPTIONS);
}

// Null when the class or event is gone.
export async function feedbackRecipients(target: FeedbackTarget): Promise<{ option: FeedbackOption; recipients: FeedbackRecipient[] } | null> {
  const option = (await feedbackOptions()).find(
    (o) => o.scope === target.scope && o.seriesKey === target.seriesKey && (target.scope === 'series' || o.eventId === target.eventId)
  );
  if (!option) return null;
  const recipients = target.scope === 'event' ? await eventSignups(option) : await classAttendees(option);
  return { option, recipients: dedupeRecipients(recipients) };
}

async function eventSignups(option: FeedbackOption): Promise<FeedbackRecipient[]> {
  const { data, error } = await hideTestRows(supabase.from('class_registrations').select('first_name, last_name, email, phone'))
    .eq('series_key', option.seriesKey)
    .is('deleted_at', null)
    .limit(ROW_LIMIT);
  if (error) throw new Error(`Couldn't load the sign-ups: ${error.message}`);
  return (data ?? []).map((r) => ({ firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone }));
}

async function classAttendees(option: FeedbackOption): Promise<FeedbackRecipient[]> {
  const series = await loadSeries('class');
  const target = series.find((s) => s.key === option.seriesKey);
  if (!target) return [];
  const eventIds = new Set(option.scope === 'series' ? target.occurrences.map((o) => o.id) : [option.eventId!]);

  // The whole class's sign-ups and check-ins, matched like the dashboard does,
  // so a check-in without an email gets the one its dancer signed up with.
  const [registrations, checkins, matches, noShows] = await Promise.all([
    hideTestRows(
      supabase.from('class_registrations').select('id, first_name, last_name, email, phone, class_title, series_mode, price, occurrence_event_id, created_at')
    )
      .eq('class_title', target.title)
      .is('deleted_at', null)
      .limit(ROW_LIMIT),
    hideTestRows(supabase.from('class_checkins').select('id, first_name, last_name, phone, email, class_title, event_id, created_at'))
      .eq('class_title', target.title)
      .is('deleted_at', null)
      .limit(ROW_LIMIT),
    supabase.from('attendance_matches').select('class_registration_id, occurrence_event_id, checkin_id'),
    supabase.from('attendance_no_shows').select('class_registration_id, occurrence_event_id'),
  ]);
  if (registrations.error || checkins.error || matches.error || noShows.error) throw new Error("Couldn't load who came.");

  const checkinRows = (checkins.data ?? []) as AttendanceCheckinRow[];
  const entries = expandRegistrationsToEntries((registrations.data ?? []) as AttendanceRegistrationRow[], series);
  const { resolved } = matchAttendance(
    entries,
    checkinRows,
    (matches.data ?? []).map((m) => ({ classRegistrationId: m.class_registration_id, occurrenceEventId: m.occurrence_event_id, checkinId: m.checkin_id })),
    (noShows.data ?? []).map((m) => ({ classRegistrationId: m.class_registration_id, occurrenceEventId: m.occurrence_event_id }))
  );
  const signupFor = new Map(resolved.filter((r) => r.matchedCheckin).map((r) => [r.matchedCheckin!.id, r]));

  return checkinRows
    .filter((c) => c.event_id && eventIds.has(c.event_id))
    .map((c) => {
      const signup = signupFor.get(c.id);
      return { firstName: c.first_name, lastName: c.last_name, email: c.email || signup?.email || null, phone: c.phone || signup?.phone || null };
    });
}

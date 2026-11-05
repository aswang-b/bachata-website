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
import { fetchAllIn, fetchAllRows } from './fetchAll';

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

// Every read is paged (fetchAll.ts): one response stops at 1000 rows, and the
// classes are read oldest first, so the newest would be the ones cut.
const MAX_OPTIONS = 300;
const day = () => siteFormatter({ month: 'short', day: 'numeric' });

async function loadSeries(eventType: 'class' | 'event'): Promise<ClassSeriesEntry[]> {
  const rows = await fetchAllRows<ClassOccurrenceRow>((from, to) =>
    supabase
      .from('events')
      .select('id, title, start_time, end_time, google_recurring_event_id, event_type')
      .in('visibility', allVisibilities())
      .eq('event_type', eventType)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  ).catch((err: Error) => {
    throw new Error(`Couldn't load the ${eventType}es: ${err.message}`);
  });
  return buildClassSeriesList(rows);
}

export async function feedbackOptions(): Promise<FeedbackOption[]> {
  return (await loadOptions()).options;
}

// The options and the classes they came from, so who came can be worked out
// without reading the classes again.
async function loadOptions(): Promise<{ options: FeedbackOption[]; classes: ClassSeriesEntry[] }> {
  const countRows = <T>(table: string, column: string) =>
    fetchAllRows<T>((from, to) => hideTestRows(supabase.from(table).select(column)).is('deleted_at', null).order('id').range(from, to)).catch(() => {
      throw new Error("Couldn't count who came.");
    });
  const [classes, events, checkins, signups] = await Promise.all([
    loadSeries('class'),
    loadSeries('event'),
    countRows<{ event_id: string | null }>('class_checkins', 'event_id'),
    countRows<{ series_key: string | null }>('class_registrations', 'series_key'),
  ]);
  const countBy = (values: (string | null)[]) => values.reduce((m, v) => (v ? m.set(v, (m.get(v) ?? 0) + 1) : m), new Map<string, number>());
  const checkinsByEvent = countBy(checkins.map((c) => c.event_id));
  const signupsBySeries = countBy(signups.map((r) => r.series_key));

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
  options.sort((a, b) => b.startTime.localeCompare(a.startTime) || Number(b.scope === 'series') - Number(a.scope === 'series'));
  return { options: options.slice(0, MAX_OPTIONS), classes };
}

// Null when the class or event is gone.
export async function feedbackRecipients(target: FeedbackTarget): Promise<{ option: FeedbackOption; recipients: FeedbackRecipient[] } | null> {
  const { options, classes } = await loadOptions();
  const option = options.find((o) => o.scope === target.scope && o.seriesKey === target.seriesKey && (target.scope === 'series' || o.eventId === target.eventId));
  if (!option) return null;
  const recipients = target.scope === 'event' ? await eventSignups(option) : await classAttendees(option, classes);
  return { option, recipients: dedupeRecipients(recipients) };
}

async function eventSignups(option: FeedbackOption): Promise<FeedbackRecipient[]> {
  const rows = await fetchAllRows<{ first_name: string; last_name: string; email: string | null; phone: string | null }>((from, to) =>
    hideTestRows(supabase.from('class_registrations').select('first_name, last_name, email, phone'))
      .eq('series_key', option.seriesKey)
      .is('deleted_at', null)
      .order('id')
      .range(from, to)
  ).catch((err: Error) => {
    throw new Error(`Couldn't load the sign-ups: ${err.message}`);
  });
  return rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone }));
}

async function classAttendees(option: FeedbackOption, series: ClassSeriesEntry[]): Promise<FeedbackRecipient[]> {
  const target = series.find((s) => s.key === option.seriesKey);
  if (!target) return [];
  const eventIds = new Set(option.scope === 'series' ? target.occurrences.map((o) => o.id) : [option.eventId!]);

  // The whole class's sign-ups and check-ins, matched like the dashboard does,
  // so a check-in without an email gets the one its dancer signed up with.
  // Matches and no-shows only for this class's dates (every class of that
  // name), plus any whose date was deleted.
  const occurrenceIds = series.filter((s) => s.title === target.title).flatMap((s) => s.occurrences.map((o) => o.id));
  type MatchRow = { class_registration_id: string; occurrence_event_id: string | null; checkin_id: string };
  type NoShowRow = { class_registration_id: string; occurrence_event_id: string | null };
  const forClass = <T>(table: string, columns: string) =>
    Promise.all([
      fetchAllIn<T>(occurrenceIds, (ids, from, to) => supabase.from(table).select(columns).in('occurrence_event_id', ids).order('id').range(from, to)),
      fetchAllRows<T>((from, to) => supabase.from(table).select(columns).is('occurrence_event_id', null).order('id').range(from, to)),
    ]).then((parts) => parts.flat());
  const [registrations, checkinRows, matches, noShows] = await Promise.all([
    fetchAllRows<AttendanceRegistrationRow>((from, to) =>
      hideTestRows(
        supabase.from('class_registrations').select('id, first_name, last_name, email, phone, class_title, series_mode, price, occurrence_event_id, created_at')
      )
        .eq('class_title', target.title)
        .is('deleted_at', null)
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<AttendanceCheckinRow>((from, to) =>
      hideTestRows(supabase.from('class_checkins').select('id, first_name, last_name, phone, email, class_title, event_id, created_at'))
        .eq('class_title', target.title)
        .is('deleted_at', null)
        .order('id')
        .range(from, to)
    ),
    forClass<MatchRow>('attendance_matches', 'class_registration_id, occurrence_event_id, checkin_id'),
    forClass<NoShowRow>('attendance_no_shows', 'class_registration_id, occurrence_event_id'),
  ]).catch(() => {
    throw new Error("Couldn't load who came.");
  });

  const entries = expandRegistrationsToEntries(registrations, series);
  const { resolved } = matchAttendance(
    entries,
    checkinRows,
    matches.map((m) => ({ classRegistrationId: m.class_registration_id, occurrenceEventId: m.occurrence_event_id, checkinId: m.checkin_id })),
    noShows.map((m) => ({ classRegistrationId: m.class_registration_id, occurrenceEventId: m.occurrence_event_id }))
  );
  const signupFor = new Map(resolved.filter((r) => r.matchedCheckin).map((r) => [r.matchedCheckin!.id, r]));

  return checkinRows
    .filter((c) => c.event_id && eventIds.has(c.event_id))
    .map((c) => {
      const signup = signupFor.get(c.id);
      return { firstName: c.first_name, lastName: c.last_name, email: c.email || signup?.email || null, phone: c.phone || signup?.phone || null };
    });
}

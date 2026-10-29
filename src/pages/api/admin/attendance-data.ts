import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { allVisibilities, hideTestRows } from '../../../lib/testMode';
import { requireAdmin } from '../../../lib/admin';
import { buildClassSeriesList } from '../../../lib/classSeries';
import {
  expandRegistrationsToEntries,
  matchAttendance,
  type AttendanceRegistrationRow,
  type AttendanceCheckinRow,
  type ManualMatch,
  type ManualNoShow,
} from '../../../lib/attendanceMatching';

export const prerender = false;

const ROW_LIMIT = 10000;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const [
    { data: registrations, error: regError },
    { data: checkins, error: checkinError },
    { data: events, error: eventsError },
    { data: manualMatchRows, error: matchError },
    { data: manualNoShowRows, error: noShowError },
  ] = await Promise.all([
    // Event registrations aren't checked in to, so they're left out of
    // attendance matching entirely (see the dashboard's Event Registration tab).
    hideTestRows(
      supabase
        .from('class_registrations')
        .select('id, first_name, last_name, email, phone, class_title, series_mode, price, occurrence_event_id, created_at, intake_submissions!inner(registration_type)')
    )
      .is('deleted_at', null)
      .neq('intake_submissions.registration_type', 'events')
      .limit(ROW_LIMIT),
    hideTestRows(supabase.from('class_checkins').select('id, first_name, last_name, phone, email, class_title, event_id, created_at'))
      .is('deleted_at', null)
      .limit(ROW_LIMIT),
    supabase
      .from('events')
      .select('id, title, start_time, end_time, google_recurring_event_id, event_type')
      .in('visibility', allVisibilities())
      .eq('event_type', 'class')
      .order('start_time', { ascending: true }),
    supabase.from('attendance_matches').select('class_registration_id, occurrence_event_id, checkin_id'),
    supabase.from('attendance_no_shows').select('class_registration_id, occurrence_event_id'),
  ]);

  if (regError || checkinError || eventsError || matchError || noShowError) {
    return new Response(JSON.stringify({ error: 'Failed to load attendance data.' }), { status: 500 });
  }

  const classSeriesList = buildClassSeriesList(events ?? []);
  const entries = expandRegistrationsToEntries((registrations ?? []) as AttendanceRegistrationRow[], classSeriesList);

  // A match whose check-in is in the Recycling Bin no longer counts, so its
  // sign-up falls back to the workqueue until that check-in is restored.
  const liveCheckinIds = new Set((checkins ?? []).map((c) => c.id));
  const manualMatches: ManualMatch[] = (manualMatchRows ?? [])
    .filter((r) => liveCheckinIds.has(r.checkin_id))
    .map((r) => ({
      classRegistrationId: r.class_registration_id,
      occurrenceEventId: r.occurrence_event_id,
      checkinId: r.checkin_id,
    }));
  const manualNoShows: ManualNoShow[] = (manualNoShowRows ?? []).map((r) => ({
    classRegistrationId: r.class_registration_id,
    occurrenceEventId: r.occurrence_event_id,
  }));

  const { resolved, orphanedCheckins } = matchAttendance(
    entries,
    (checkins ?? []) as AttendanceCheckinRow[],
    manualMatches,
    manualNoShows
  );

  return new Response(JSON.stringify({ entries: resolved, orphanedCheckins }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

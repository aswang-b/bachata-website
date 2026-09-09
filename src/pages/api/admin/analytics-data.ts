import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { buildClassSeriesList } from '../../../lib/classSeries';

export const prerender = false;

// The dashboard loads everything into memory for client-side search/sort/
// filter, so this isn't true pagination — it's a backstop cap so a studio's
// multi-year history can't turn one analytics page load into an unbounded
// full-table fetch. Generous enough to never realistically truncate a real
// studio's data; revisit with real pagination if that stops being true.
const ANALYTICS_ROW_LIMIT = 10000;

interface Dancer {
  firstName?: string;
  lastName?: string;
  role?: string;
  phone?: string;
  email?: string;
}

interface ClassRegistrationRow {
  id: string;
  submission_id: string;
  dancer_index: number | null;
  class_title: string;
  class_label: string;
  series_mode: 'whole' | 'dropin' | null;
  price: number | null;
}

export interface ClassRegistrationEntry {
  id: string | null;
  classLabel: string;
  seriesMode: 'whole' | 'dropin' | null;
  price: number | null;
}

interface SignupRow {
  submissionId: string;
  createdAt: string;
  registrationType: string;
  paymentMethod: string | null;
  paid: boolean;
  dancerIndex: number | null;
  dancerCount: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  classRegistrations: ClassRegistrationEntry[];
}

const EMPTY_CLASS_ENTRY: ClassRegistrationEntry = { id: null, classLabel: '', seriesMode: null, price: null };

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const [
    { data: intakeRows, error: intakeError },
    { data: checkinRows, error: checkinError },
    { data: classEvents, error: eventsError },
    { data: allClassEvents, error: allClassEventsError },
    { data: classRegistrationRows, error: classRegistrationsError },
  ] = await Promise.all([
    supabase
      .from('intake_submissions')
      .select('id, created_at, registration_type, first_name, last_name, email, phone, dancers, payment_method, paid')
      .order('created_at', { ascending: false })
      .limit(ANALYTICS_ROW_LIMIT),
    supabase
      .from('class_checkins')
      .select('id, created_at, first_name, last_name, phone, class_title, event_id')
      .order('created_at', { ascending: false })
      .limit(ANALYTICS_ROW_LIMIT),
    supabase.from('events').select('title').eq('event_type', 'class').order('title', { ascending: true }),
    // Admins can attach a check-in to any class occurrence, past or future,
    // so this isn't filtered to upcoming/public like the check-in.astro form.
    supabase
      .from('events')
      .select('id, title, start_time, end_time, google_recurring_event_id, price_whole_series, price_drop_in')
      .eq('event_type', 'class')
      .order('start_time', { ascending: true }),
    supabase
      .from('class_registrations')
      .select('id, submission_id, dancer_index, class_title, class_label, series_mode, price')
      .limit(ANALYTICS_ROW_LIMIT),
  ]);

  if (intakeError || checkinError || eventsError || allClassEventsError || classRegistrationsError) {
    return new Response(JSON.stringify({ error: 'Failed to load analytics data.' }), { status: 500 });
  }

  const classSeries = buildClassSeriesList(allClassEvents ?? []);

  // Group each submission's class registrations by dancer (dancer_index, or
  // null for a class-less single-registrant submission), so each dancer row
  // below can attach its own real per-class breakdown instead of re-parsing
  // a semicolon-joined string.
  const registrationsBySubmission = new Map<string, Map<number | null, ClassRegistrationEntry[]>>();
  for (const reg of (classRegistrationRows ?? []) as ClassRegistrationRow[]) {
    let byDancer = registrationsBySubmission.get(reg.submission_id);
    if (!byDancer) {
      byDancer = new Map();
      registrationsBySubmission.set(reg.submission_id, byDancer);
    }
    const entry: ClassRegistrationEntry = { id: reg.id, classLabel: reg.class_label, seriesMode: reg.series_mode, price: reg.price };
    const existing = byDancer.get(reg.dancer_index);
    if (existing) existing.push(entry);
    else byDancer.set(reg.dancer_index, [entry]);
  }

  const signups = (intakeRows ?? []).flatMap((row): SignupRow[] => {
    const dancers = Array.isArray(row.dancers) ? (row.dancers as Dancer[]) : null;
    const byDancer = registrationsBySubmission.get(row.id);
    const shared = {
      submissionId: row.id,
      createdAt: row.created_at,
      registrationType: row.registration_type,
      paymentMethod: row.payment_method,
      paid: row.paid,
    };

    if (dancers && dancers.length > 0) {
      return dancers.map((d, i) => ({
        ...shared,
        dancerIndex: i,
        dancerCount: dancers.length,
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        email: d.email || row.email || '',
        phone: d.phone || row.phone || '',
        classRegistrations: byDancer?.get(i) ?? [EMPTY_CLASS_ENTRY],
      }));
    }

    return [
      {
        ...shared,
        dancerIndex: null,
        dancerCount: 0,
        firstName: row.first_name ?? '',
        lastName: row.last_name ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        classRegistrations: byDancer?.get(null) ?? [EMPTY_CLASS_ENTRY],
      },
    ];
  });

  // Look up the specific scheduled date/time of the class each check-in was for.
  const eventIds = [...new Set((checkinRows ?? []).map((r) => r.event_id).filter(Boolean))] as string[];
  const eventDateById = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: checkinEvents } = await supabase.from('events').select('id, start_time').in('id', eventIds);
    for (const e of checkinEvents ?? []) eventDateById.set(e.id, e.start_time);
  }

  const checkins = (checkinRows ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    classTitle: row.class_title,
    eventId: row.event_id,
    classDate: row.event_id ? eventDateById.get(row.event_id) ?? null : null,
  }));

  const classTitles = [...new Set((classEvents ?? []).map((e) => e.title))];

  return new Response(JSON.stringify({ signups, checkins, classTitles, classSeries }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

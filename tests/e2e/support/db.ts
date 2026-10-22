import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { env, RUN_ID, TEST_PREFIX } from './env';

// Service-role access to the (shared) database, for seeding and checking test
// data. Everything written here is prefixed ZZZ and removed by sweepTestData.
export const db: SupabaseClient = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const DAY = 24 * 60 * 60 * 1000;

// Seeded classes sit past the calendar sync's 180-day window, so the live
// 15-minute sync never pushes them to Google or deletes them mid-test. They
// carry fake Google ids for the same reason.
export function farFuture(daysPast180: number, hourUtc = 1): string {
  const d = new Date(Date.now() + (190 + daysPast180) * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

export interface SeedOptions {
  name: string;
  type?: 'class' | 'event';
  occurrences?: number;
  priceWhole?: number | null;
  priceDropIn?: number | null;
  capacity?: number | null;
  capacityByRole?: boolean;
  leaderCapacity?: number | null;
  followerCapacity?: number | null;
  showCapacity?: boolean;
  registrationClosed?: boolean;
  description?: string;
  dayOffset?: number;
}

export interface Seeded {
  title: string;
  key: string;
  ids: string[];
}

export const testTitle = (name: string) => `${TEST_PREFIX} E2E ${RUN_ID} ${name}`;

export async function seedEvent(o: SeedOptions): Promise<Seeded> {
  const title = testTitle(o.name);
  const n = o.occurrences ?? 1;
  const recurring = n > 1 ? `zzz-e2e-series-${randomUUID()}` : null;
  const rows = Array.from({ length: n }, (_, i) => ({
    title,
    event_type: o.type ?? 'class',
    visibility: 'public',
    color: 'green',
    location: 'ZZZ Test Studio',
    start_time: farFuture((o.dayOffset ?? 0) + i * 7, 1),
    end_time: farFuture((o.dayOffset ?? 0) + i * 7, 2),
    google_event_id: `zzz-e2e-${randomUUID()}`,
    google_recurring_event_id: recurring,
    price_whole_series: o.priceWhole === undefined ? 50 : o.priceWhole,
    price_drop_in: o.priceDropIn ?? null,
    registration_closed: o.registrationClosed ?? false,
    description: o.description ?? null,
    capacity: o.capacity ?? null,
    capacity_by_role: o.capacityByRole ?? false,
    leader_capacity: o.leaderCapacity ?? null,
    follower_capacity: o.followerCapacity ?? null,
    show_capacity: o.showCapacity ?? false,
  }));
  const { data, error } = await db.from('events').insert(rows).select('id, start_time').order('start_time');
  if (error || !data) throw new Error(`Seeding "${title}" failed: ${error?.message}`);
  const ids = data.map((r) => r.id as string);
  return { title, key: recurring ?? ids[0], ids };
}

export interface SeedDancer {
  first: string;
  last?: string;
  role?: 'leader' | 'follower' | '';
  email?: string;
  phone?: string;
}

// A sign-up written straight to the database (no form, no email), for tests
// that need someone already registered.
export async function seedSignup(event: Seeded, dancers: SeedDancer[], registrationType: 'group' | 'events' = 'group'): Promise<string> {
  const people = dancers.map((d) => ({
    firstName: `${TEST_PREFIX}${d.first}`,
    lastName: d.last ?? RUN_ID,
    role: d.role ?? '',
    phone: d.phone ?? '5550100',
    email: d.email ?? '',
  }));
  const { data: sub, error } = await db
    .from('intake_submissions')
    .insert({
      registration_type: registrationType,
      first_name: people[0].firstName,
      last_name: people[0].lastName,
      phone: people[0].phone,
      class: event.title,
      dancers: people,
      payment_method: 'cash',
    })
    .select('id')
    .single();
  if (error || !sub) throw new Error(`Seeding a sign-up failed: ${error?.message}`);
  const { error: regError } = await db.from('class_registrations').insert(
    people.map((p, i) => ({
      submission_id: sub.id,
      dancer_index: i,
      first_name: p.firstName,
      last_name: p.lastName,
      phone: p.phone,
      class_title: event.title,
      class_label: event.title,
      series_mode: 'whole',
      series_key: event.key,
      price: 50,
    }))
  );
  if (regError) throw new Error(`Seeding registrations failed: ${regError.message}`);
  return sub.id as string;
}

export async function spotCounts(eventId: string) {
  const { data } = await db.from('event_spot_counts').select('taken, leaders_taken, followers_taken').eq('event_id', eventId).maybeSingle();
  return data;
}

// Deletes every ZZZ row the suite (or an earlier, crashed run) left behind.
export async function sweepTestData(): Promise<void> {
  const like = `${TEST_PREFIX}%`;
  const results = await Promise.all([
    db.from('intake_submissions').delete().ilike('first_name', like),
    db.from('class_checkins').delete().ilike('first_name', like),
    db.from('deals').delete().ilike('name', like),
  ]);
  // Sign-ups first: class registrations point at the events' occurrences.
  const events = await db.from('events').delete().ilike('title', like);
  for (const r of [...results, events]) if (r.error) throw new Error(`Cleanup failed: ${r.error.message}`);
}

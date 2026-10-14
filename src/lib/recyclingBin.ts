import { supabase } from './supabase';

// The dancer dashboard's Recycling Bin. Deletes there never remove rows
// directly: they flag them (deleted_at/deleted_by), and every row flagged by
// one delete shares a deletion_id so it can be restored as a group. Normal
// views filter flagged rows out; emptying the bin hard-deletes them.
//
// One dancer of a group sign-up isn't a row of its own, so that dancer is
// flagged inside intake_submissions.dancers with the same three fields
// (plus `deleted: true`, which is what the JSON containment queries match).

export class RecyclingBinError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

// The deletes, restore, and empty run as database functions (migration 0040)
// that lock the sign-up row, so two admins on different dashboard tabs can't
// overwrite each other's change to a group sign-up's dancers list.
async function callBinFunction(fn: string, args: Record<string, unknown>, failure: string): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (!error) return;
  // P0002 is the functions' "not found".
  if (error.code === 'P0002') throw new RecyclingBinError(error.message, 404);
  console.error(`${fn} failed:`, error.message);
  throw new RecyclingBinError(failure, 500);
}

// JSON (not an array) so supabase-js sends a jsonb containment filter rather
// than a Postgres array literal.
const DELETED_DANCER_FILTER = JSON.stringify([{ deleted: true }]);

interface DancerJson {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deletionId?: string;
  [key: string]: unknown;
}

export function isDeletedDancer(dancer: unknown): boolean {
  return Boolean(dancer && typeof dancer === 'object' && (dancer as DancerJson).deleted);
}

export async function softDeleteCheckin(checkinId: string, deletedBy: string): Promise<void> {
  const { data, error } = await supabase
    .from('class_checkins')
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy, deletion_id: crypto.randomUUID() })
    .eq('id', checkinId)
    .is('deleted_at', null)
    .select('id');
  if (error) throw new RecyclingBinError('Failed to delete the check-in.', 500);
  if (!data || data.length === 0) throw new RecyclingBinError('Check-in not found.', 404);
}

// Deletes one dancer of a sign-up, or the whole sign-up when that dancer is
// its only (remaining) one. dancerIndex null means a single-registrant sign-up.
export async function softDeleteDancer(submissionId: string, dancerIndex: number | null, deletedBy: string): Promise<void> {
  await callBinFunction(
    'soft_delete_dancer',
    { p_submission_id: submissionId, p_dancer_index: dancerIndex, p_deleted_by: deletedBy },
    'Failed to delete the sign-up.'
  );
}

// Deletes one class registration (e.g. an orphaned sign-up from the
// attendance workqueue). If it's the dancer's last remaining class, the
// dancer (or the whole single-dancer sign-up) goes with it, so the Sign-Ups
// tab is never left with a class-less row.
export async function softDeleteRegistration(registrationId: string, deletedBy: string): Promise<void> {
  await callBinFunction('soft_delete_registration', { p_registration_id: registrationId, p_deleted_by: deletedBy }, 'Failed to delete the sign-up.');
}

export interface RecyclingBinItem {
  deletionId: string;
  kind: 'signup' | 'dancer' | 'class' | 'checkin';
  deletedAt: string;
  deletedBy: string | null;
  name: string;
  classes: { title: string; mode: 'whole' | 'dropin' | null; date: string | null }[];
}

interface FlaggedRegistration {
  submission_id: string;
  dancer_index: number | null;
  first_name: string;
  last_name: string;
  class_title: string;
  series_mode: 'whole' | 'dropin' | null;
  occurrence_event_id: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deletion_id: string;
}

const fullName = (first?: string | null, last?: string | null) => `${first ?? ''} ${last ?? ''}`.trim() || '—';

// Each listing query stops at this many rows (newest first), so a bin that
// has grown huge still loads; the page then says it isn't showing everything.
const BIN_LIST_LIMIT = 500;

export async function listRecyclingBin(): Promise<{ items: RecyclingBinItem[]; truncated: boolean }> {
  const [checkins, submissions, registrations, dancerSubmissions] = await Promise.all([
    supabase
      .from('class_checkins')
      .select('first_name, last_name, class_title, event_id, deleted_at, deleted_by, deletion_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(BIN_LIST_LIMIT),
    supabase
      .from('intake_submissions')
      .select('first_name, last_name, dancers, deleted_at, deleted_by, deletion_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(BIN_LIST_LIMIT),
    supabase
      .from('class_registrations')
      .select('submission_id, dancer_index, first_name, last_name, class_title, series_mode, occurrence_event_id, deleted_at, deleted_by, deletion_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(BIN_LIST_LIMIT),
    supabase
      .from('intake_submissions')
      .select('dancers')
      .contains('dancers', DELETED_DANCER_FILTER)
      .order('created_at', { ascending: false })
      .limit(BIN_LIST_LIMIT),
  ]);
  if (checkins.error || submissions.error || registrations.error || dancerSubmissions.error) {
    throw new RecyclingBinError('Failed to load the recycling bin.', 500);
  }

  const regs = (registrations.data ?? []) as FlaggedRegistration[];
  const eventIds = [
    ...new Set([...(checkins.data ?? []).map((c) => c.event_id), ...regs.map((r) => r.occurrence_event_id)].filter((id): id is string => Boolean(id))),
  ];
  const startById = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: events } = await supabase.from('events').select('id, start_time').in('id', eventIds);
    for (const e of events ?? []) startById.set(e.id, e.start_time);
  }

  const regsByDeletion = new Map<string, FlaggedRegistration[]>();
  for (const r of regs) regsByDeletion.set(r.deletion_id, [...(regsByDeletion.get(r.deletion_id) ?? []), r]);
  const classesOf = (deletionId: string) =>
    (regsByDeletion.get(deletionId) ?? []).map((r) => ({
      title: r.class_title,
      mode: r.series_mode,
      date: r.occurrence_event_id ? startById.get(r.occurrence_event_id) ?? null : null,
    }));

  const items: RecyclingBinItem[] = [];
  const claimed = new Set<string>();

  for (const s of submissions.data ?? []) {
    claimed.add(s.deletion_id);
    const dancers = Array.isArray(s.dancers) ? (s.dancers as DancerJson[]).filter((d) => !isDeletedDancer(d)) : [];
    const name = dancers.length > 0 ? dancers.map((d) => fullName(d.firstName, d.lastName)).join(', ') : fullName(s.first_name, s.last_name);
    items.push({ deletionId: s.deletion_id, kind: 'signup', deletedAt: s.deleted_at, deletedBy: s.deleted_by, name, classes: classesOf(s.deletion_id) });
  }

  for (const s of dancerSubmissions.data ?? []) {
    for (const d of (s.dancers as DancerJson[]) ?? []) {
      if (!isDeletedDancer(d) || !d.deletionId || claimed.has(d.deletionId)) continue;
      claimed.add(d.deletionId);
      items.push({
        deletionId: d.deletionId,
        kind: 'dancer',
        deletedAt: d.deletedAt ?? '',
        deletedBy: d.deletedBy ?? null,
        name: fullName(d.firstName, d.lastName),
        classes: classesOf(d.deletionId),
      });
    }
  }

  for (const [deletionId, group] of regsByDeletion) {
    if (claimed.has(deletionId)) continue;
    items.push({
      deletionId,
      kind: 'class',
      deletedAt: group[0].deleted_at,
      deletedBy: group[0].deleted_by,
      name: fullName(group[0].first_name, group[0].last_name),
      classes: classesOf(deletionId),
    });
  }

  for (const c of checkins.data ?? []) {
    items.push({
      deletionId: c.deletion_id,
      kind: 'checkin',
      deletedAt: c.deleted_at,
      deletedBy: c.deleted_by,
      name: fullName(c.first_name, c.last_name),
      classes: [{ title: c.class_title, mode: null, date: c.event_id ? startById.get(c.event_id) ?? null : null }],
    });
  }

  const truncated = [checkins, submissions, registrations, dancerSubmissions].some((r) => (r.data?.length ?? 0) >= BIN_LIST_LIMIT);
  return { items: items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)), truncated };
}

// Clears the flag from every row (and group-sign-up dancer) a delete marked.
export async function restoreDeletion(deletionId: string): Promise<void> {
  await callBinFunction('restore_deletion', { p_deletion_id: deletionId }, 'Failed to restore.');
}

// Permanently deletes everything in the bin, all or nothing.
export async function emptyRecyclingBin(): Promise<void> {
  await callBinFunction('empty_recycling_bin', {}, 'Failed to empty the recycling bin.');
}

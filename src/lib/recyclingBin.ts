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

interface Mark {
  deleted_at: string;
  deleted_by: string;
  deletion_id: string;
}

// JSON (not an array) so supabase-js sends a jsonb containment filter rather
// than a Postgres array literal.
const DELETED_DANCER_FILTER = JSON.stringify([{ deleted: true }]);

const UNMARK = { deleted_at: null, deleted_by: null, deletion_id: null };

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

function newMark(deletedBy: string): Mark {
  return { deleted_at: new Date().toISOString(), deleted_by: deletedBy, deletion_id: crypto.randomUUID() };
}

export function isDeletedDancer(dancer: unknown): boolean {
  return Boolean(dancer && typeof dancer === 'object' && (dancer as DancerJson).deleted);
}

function unflagDancer({ deleted, deletedAt, deletedBy, deletionId, ...rest }: DancerJson): DancerJson {
  return rest;
}

export async function softDeleteCheckin(checkinId: string, deletedBy: string): Promise<void> {
  const { data, error } = await supabase
    .from('class_checkins')
    .update(newMark(deletedBy))
    .eq('id', checkinId)
    .is('deleted_at', null)
    .select('id');
  if (error) throw new RecyclingBinError('Failed to delete the check-in.', 500);
  if (!data || data.length === 0) throw new RecyclingBinError('Check-in not found.', 404);
}

async function flagSubmission(submissionId: string, mark: Mark): Promise<void> {
  const { data, error } = await supabase.from('intake_submissions').update(mark).eq('id', submissionId).is('deleted_at', null).select('id');
  if (error) throw new RecyclingBinError('Failed to delete the sign-up.', 500);
  if (!data || data.length === 0) throw new RecyclingBinError('Sign-up not found.', 404);
  const { error: regError } = await supabase.from('class_registrations').update(mark).eq('submission_id', submissionId).is('deleted_at', null);
  if (regError) throw new RecyclingBinError('Failed to delete the sign-up classes.', 500);
}

// Deletes one dancer of a sign-up, or the whole sign-up when that dancer is
// its only (remaining) one. dancerIndex null means a single-registrant sign-up.
export async function softDeleteDancer(submissionId: string, dancerIndex: number | null, deletedBy: string): Promise<void> {
  const mark = newMark(deletedBy);
  const { data: row, error } = await supabase.from('intake_submissions').select('id, dancers').eq('id', submissionId).is('deleted_at', null).maybeSingle();
  if (error) throw new RecyclingBinError('Failed to load the sign-up.', 500);
  if (!row) throw new RecyclingBinError('Sign-up not found.', 404);

  const dancers = Array.isArray(row.dancers) ? (row.dancers as DancerJson[]) : null;
  const liveCount = dancers ? dancers.filter((d) => !isDeletedDancer(d)).length : 0;
  if (dancerIndex === null || !dancers || liveCount <= 1) {
    await flagSubmission(submissionId, mark);
    return;
  }
  if (dancerIndex < 0 || dancerIndex >= dancers.length || isDeletedDancer(dancers[dancerIndex])) {
    throw new RecyclingBinError('Dancer not found.', 404);
  }

  const nextDancers = dancers.map((d, i) =>
    i === dancerIndex ? { ...d, deleted: true, deletedAt: mark.deleted_at, deletedBy: mark.deleted_by, deletionId: mark.deletion_id } : d
  );
  const { error: updateError } = await supabase.from('intake_submissions').update({ dancers: nextDancers }).eq('id', submissionId);
  if (updateError) throw new RecyclingBinError('Failed to remove the dancer.', 500);
  const { error: regError } = await supabase
    .from('class_registrations')
    .update(mark)
    .eq('submission_id', submissionId)
    .eq('dancer_index', dancerIndex)
    .is('deleted_at', null);
  if (regError) throw new RecyclingBinError("Failed to delete the dancer's classes.", 500);
}

// Deletes one class registration (e.g. an orphaned sign-up from the
// attendance workqueue). If it's the dancer's last remaining class, the
// dancer (or the whole single-dancer sign-up) goes with it, so the Sign-Ups
// tab is never left with a class-less row.
export async function softDeleteRegistration(registrationId: string, deletedBy: string): Promise<void> {
  const { data: reg, error } = await supabase
    .from('class_registrations')
    .select('id, submission_id, dancer_index')
    .eq('id', registrationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new RecyclingBinError('Failed to load the sign-up.', 500);
  if (!reg) throw new RecyclingBinError('Sign-up not found.', 404);

  let siblings = supabase
    .from('class_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('submission_id', reg.submission_id)
    .neq('id', reg.id)
    .is('deleted_at', null);
  siblings = reg.dancer_index === null ? siblings.is('dancer_index', null) : siblings.eq('dancer_index', reg.dancer_index);
  const { count, error: countError } = await siblings;
  if (countError) throw new RecyclingBinError('Failed to load the sign-up.', 500);

  if (!count) {
    await softDeleteDancer(reg.submission_id, reg.dancer_index, deletedBy);
    return;
  }
  const { error: updateError } = await supabase.from('class_registrations').update(newMark(deletedBy)).eq('id', reg.id);
  if (updateError) throw new RecyclingBinError('Failed to delete the sign-up.', 500);
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

export async function listRecyclingBin(): Promise<RecyclingBinItem[]> {
  const [checkins, submissions, registrations, dancerSubmissions] = await Promise.all([
    supabase
      .from('class_checkins')
      .select('first_name, last_name, class_title, event_id, deleted_at, deleted_by, deletion_id')
      .not('deleted_at', 'is', null),
    supabase.from('intake_submissions').select('first_name, last_name, dancers, deleted_at, deleted_by, deletion_id').not('deleted_at', 'is', null),
    supabase
      .from('class_registrations')
      .select('submission_id, dancer_index, first_name, last_name, class_title, series_mode, occurrence_event_id, deleted_at, deleted_by, deletion_id')
      .not('deleted_at', 'is', null),
    supabase.from('intake_submissions').select('dancers').contains('dancers', DELETED_DANCER_FILTER),
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

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// Clears the flag from every row (and group-sign-up dancer) a delete marked.
export async function restoreDeletion(deletionId: string): Promise<void> {
  const results = await Promise.all([
    supabase.from('intake_submissions').update(UNMARK).eq('deletion_id', deletionId),
    supabase.from('class_registrations').update(UNMARK).eq('deletion_id', deletionId),
    supabase.from('class_checkins').update(UNMARK).eq('deletion_id', deletionId),
  ]);
  if (results.some((r) => r.error)) throw new RecyclingBinError('Failed to restore.', 500);

  const { data: withDancer, error } = await supabase.from('intake_submissions').select('id, dancers').contains('dancers', JSON.stringify([{ deletionId }]));
  if (error) throw new RecyclingBinError('Failed to restore.', 500);
  for (const s of withDancer ?? []) {
    const dancers = (s.dancers as DancerJson[]).map((d) => (d.deletionId === deletionId ? unflagDancer(d) : d));
    const { error: updateError } = await supabase.from('intake_submissions').update({ dancers }).eq('id', s.id);
    if (updateError) throw new RecyclingBinError('Failed to restore the dancer.', 500);
  }
}

// Drops flagged dancers out of a group sign-up for good: deletes their class
// registrations and shifts later dancers' registrations down so dancer_index
// keeps lining up with the dancers array.
async function purgeDeletedDancers(submission: { id: string; dancers: DancerJson[] }): Promise<void> {
  const removed = submission.dancers.map((d, i) => (isDeletedDancer(d) ? i : -1)).filter((i) => i >= 0);
  const nextDancers = submission.dancers.filter((d) => !isDeletedDancer(d));

  const { data: regs, error } = await supabase.from('class_registrations').select('id, dancer_index').eq('submission_id', submission.id);
  if (error) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);
  for (const r of regs ?? []) {
    if (r.dancer_index === null) continue;
    if (removed.includes(r.dancer_index)) {
      await supabase.from('class_registrations').delete().eq('id', r.id);
      continue;
    }
    const shift = removed.filter((i) => i < r.dancer_index!).length;
    if (shift > 0) await supabase.from('class_registrations').update({ dancer_index: r.dancer_index - shift }).eq('id', r.id);
  }

  const { error: updateError } = await supabase
    .from('intake_submissions')
    .update({
      dancers: nextDancers,
      first_name: nextDancers[0]?.firstName ?? '',
      last_name: nextDancers[0]?.lastName ?? '',
      email: nextDancers[0]?.email || null,
      phone: nextDancers[0]?.phone || null,
    })
    .eq('id', submission.id);
  if (updateError) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);
}

// Permanently deletes everything in the bin.
export async function emptyRecyclingBin(): Promise<void> {
  const { error: checkinError } = await supabase.from('class_checkins').delete().not('deleted_at', 'is', null);
  if (checkinError) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);

  const { data: withDancers, error } = await supabase
    .from('intake_submissions')
    .select('id, dancers')
    .contains('dancers', DELETED_DANCER_FILTER)
    .is('deleted_at', null);
  if (error) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);
  for (const s of withDancers ?? []) await purgeDeletedDancers({ id: s.id, dancers: s.dancers as DancerJson[] });

  // Cascades to the deleted sign-ups' class registrations and attendance links.
  const { error: submissionError } = await supabase.from('intake_submissions').delete().not('deleted_at', 'is', null);
  if (submissionError) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);
  const { error: regError } = await supabase.from('class_registrations').delete().not('deleted_at', 'is', null);
  if (regError) throw new RecyclingBinError('Failed to empty the recycling bin.', 500);
}

import { supabase } from './supabase';
import { chicagoDayBoundsUtcIso } from './classSeries';
import { softDeleteCheckin, softDeleteDancer } from './recyclingBin';
import { DUPLICATE_DELETED_BY } from './duplicateFlag';

// Catches the obvious duplicates a double-click or a resubmitted form creates.
// The new rows are saved first and then compared against what was already
// there; a match moves the NEWER copy to the Recycling Bin (flagged with
// DUPLICATE_DELETED_BY, so an admin can restore it), and the caller sends the
// dancer to the original's confirmation. Comparing "created strictly earlier"
// (ties broken by id) means two racing requests agree on which one survives.

// A resubmission of the same sign-up within this window counts as a duplicate.
const SIGNUP_DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

interface Stamped {
  id: string;
  created_at: string;
}

function isEarlier(a: Stamped, b: Stamped): boolean {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  return at < bt || (at === bt && a.id < b.id);
}

interface CheckinRow extends Stamped {
  first_name: string;
  last_name: string;
  class_title: string;
  event_id: string | null;
}

// Same person (by name) checked into the same class occurrence — or, for a
// title-only check-in with no occurrence, the same class on the same day.
// Returns new check-in id -> the original it duplicates.
export async function flagDuplicateCheckins(newIds: string[]): Promise<Map<string, string>> {
  const originals = new Map<string, string>();
  if (newIds.length === 0) return originals;

  const { data: rows, error } = await supabase
    .from('class_checkins')
    .select('id, created_at, first_name, last_name, class_title, event_id')
    .in('id', newIds);
  if (error || !rows) {
    console.error('Duplicate check-in check failed to load the new rows:', error);
    return originals;
  }

  for (const row of rows as CheckinRow[]) {
    let query = supabase
      .from('class_checkins')
      .select('id, created_at, first_name, last_name, class_title, event_id')
      .is('deleted_at', null)
      .neq('id', row.id)
      .lte('created_at', row.created_at);
    if (row.event_id) {
      query = query.eq('event_id', row.event_id);
    } else {
      const { startIso, endIso } = chicagoDayBoundsUtcIso(new Date(row.created_at));
      query = query.is('event_id', null).eq('class_title', row.class_title).gte('created_at', startIso).lt('created_at', endIso);
    }

    const { data: candidates, error: candidateError } = await query;
    if (candidateError) {
      console.error('Duplicate check-in check failed:', candidateError);
      continue;
    }
    const original = (candidates as CheckinRow[] | null)?.find(
      (c) => norm(c.first_name) === norm(row.first_name) && norm(c.last_name) === norm(row.last_name) && isEarlier(c, row)
    );
    if (!original) continue;

    try {
      await softDeleteCheckin(row.id, DUPLICATE_DELETED_BY);
      originals.set(row.id, original.id);
    } catch (err) {
      console.error('Failed to move a duplicate check-in to the Recycling Bin:', err);
    }
  }
  return originals;
}

interface SubmissionRow extends Stamped {
  registration_type: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  class: string | null;
  comments: string | null;
  payment_method: string | null;
  dancers: unknown;
}

// Everything a dancer typed: identical fingerprints within the window are the
// same sign-up submitted twice.
function submissionFingerprint(s: SubmissionRow): string {
  const dancers = Array.isArray(s.dancers)
    ? (s.dancers as Record<string, unknown>[])
        .map((d) => [d.firstName, d.lastName, d.role, d.email, d.phone].map(norm).join('|'))
        .sort()
        .join('||')
    : '';
  const fields = [s.registration_type, s.first_name, s.last_name, s.email, s.phone, s.class, s.comments, s.payment_method].map(norm);
  return [...fields, dancers].join('#');
}

const SUBMISSION_COLUMNS = 'id, created_at, registration_type, first_name, last_name, email, phone, class, comments, payment_method, dancers';

// Returns the original submission's id when `submissionId` duplicates an
// earlier live one (and has been moved to the Recycling Bin), else null.
export async function flagDuplicateSubmission(submissionId: string): Promise<string | null> {
  const { data: row, error } = await supabase.from('intake_submissions').select(SUBMISSION_COLUMNS).eq('id', submissionId).maybeSingle();
  if (error || !row) {
    console.error('Duplicate sign-up check failed to load the new row:', error);
    return null;
  }
  const submission = row as SubmissionRow;

  const since = new Date(Date.parse(submission.created_at) - SIGNUP_DUPLICATE_WINDOW_MS).toISOString();
  const { data: candidates, error: candidateError } = await supabase
    .from('intake_submissions')
    .select(SUBMISSION_COLUMNS)
    .is('deleted_at', null)
    .neq('id', submission.id)
    .eq('registration_type', submission.registration_type)
    .gte('created_at', since)
    .lte('created_at', submission.created_at);
  if (candidateError) {
    console.error('Duplicate sign-up check failed:', candidateError);
    return null;
  }

  const fingerprint = submissionFingerprint(submission);
  const original = (candidates as SubmissionRow[] | null)?.find((c) => isEarlier(c, submission) && submissionFingerprint(c) === fingerprint);
  if (!original) return null;

  try {
    // dancerIndex null flags the whole sign-up and its class registrations.
    await softDeleteDancer(submission.id, null, DUPLICATE_DELETED_BY);
    return original.id;
  } catch (err) {
    console.error('Failed to move a duplicate sign-up to the Recycling Bin:', err);
    return null;
  }
}

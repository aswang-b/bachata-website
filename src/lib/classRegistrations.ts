import { supabase } from './supabase';

export interface ParsedClassSelection {
  label: string;
  title: string;
  mode: 'whole' | 'dropin' | null;
}

// Mirrors register.astro's updateClassValue() wire format:
// "<title> — <subLabel>[ — Whole Series|Drop In]", multiple selections
// joined by "; ". Also handles the events picker's single-selection format
// (no mode suffix), which just falls through to mode: null.
export function parseClassSelectionString(raw: string | null | undefined): ParsedClassSelection[] {
  const value = (raw ?? '').trim();
  if (!value) return [];

  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const segments = part.split('—').map((s) => s.trim());
      const last = segments[segments.length - 1];
      const title = segments[0] ?? part;
      if (last === 'Whole Series' || last === 'Drop In') {
        return { label: segments.slice(0, -1).join(' — '), title, mode: last === 'Whole Series' ? 'whole' : 'dropin' } as ParsedClassSelection;
      }
      return { label: part, title, mode: null } as ParsedClassSelection;
    });
}

interface DancerLike {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface ClassRegistrationRow {
  id: string;
  submission_id: string;
  dancer_index: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  class_title: string;
  class_label: string;
  series_mode: 'whole' | 'dropin' | null;
  price: number | null;
  created_at: string;
}

async function lookupClassPrices(): Promise<Map<string, { whole: number | null; dropIn: number | null }>> {
  const { data, error } = await supabase.from('events').select('title, price_whole_series, price_drop_in').eq('event_type', 'class');
  if (error) console.error('Failed to load class prices for registration snapshot:', error.message);

  const priceByTitle = new Map<string, { whole: number | null; dropIn: number | null }>();
  for (const e of data ?? []) {
    if (!priceByTitle.has(e.title)) priceByTitle.set(e.title, { whole: e.price_whole_series, dropIn: e.price_drop_in });
  }
  return priceByTitle;
}

function buildRegistrationRows(
  submissionId: string,
  dancerIndex: number | null,
  dancer: DancerLike,
  selections: ParsedClassSelection[],
  priceByTitle: Map<string, { whole: number | null; dropIn: number | null }>
) {
  return selections.map((sel) => {
    const prices = priceByTitle.get(sel.title);
    const price = sel.mode === 'dropin' ? prices?.dropIn ?? null : prices?.whole ?? null;
    return {
      submission_id: submissionId,
      dancer_index: dancerIndex,
      first_name: dancer.firstName ?? '',
      last_name: dancer.lastName ?? '',
      email: dancer.email || null,
      phone: dancer.phone || null,
      class_title: sel.title,
      class_label: sel.label,
      series_mode: sel.mode,
      price,
    };
  });
}

// Snapshots one row per (dancer, class) pair at submission time — price is
// looked up once here and stored, so a later class rename/price change
// doesn't retroactively change what a past registration is shown to owe.
export async function insertClassRegistrations(params: {
  submissionId: string;
  classRaw: string | null;
  dancers: DancerLike[] | null;
  fallbackFirstName: string;
  fallbackLastName: string;
  fallbackEmail: string | null;
  fallbackPhone: string | null;
}): Promise<void> {
  const selections = parseClassSelectionString(params.classRaw);
  if (selections.length === 0) return;

  const priceByTitle = await lookupClassPrices();
  const recipients: DancerLike[] =
    params.dancers && params.dancers.length > 0
      ? params.dancers
      : [{ firstName: params.fallbackFirstName, lastName: params.fallbackLastName, email: params.fallbackEmail ?? undefined, phone: params.fallbackPhone ?? undefined }];

  const rows = recipients.flatMap((d, dancerIndex) => buildRegistrationRows(params.submissionId, params.dancers ? dancerIndex : null, d, selections, priceByTitle));
  if (rows.length === 0) return;

  const { error } = await supabase.from('class_registrations').insert(rows);
  if (error) console.error('Failed to insert class registrations:', error.message);
}

// Replaces exactly one dancer's class registrations (matched by submission +
// dancer_index, or dancer_index IS NULL for a class-less single-registrant
// submission) without touching any other dancer's rows on the same
// submission — used by the admin edit UI, where editing one dancer's class
// list must never clobber another dancer's classes.
export async function replaceClassRegistrations(params: {
  submissionId: string;
  dancerIndex: number | null;
  classRaw: string | null;
  dancer: DancerLike;
}): Promise<void> {
  let deleteQuery = supabase.from('class_registrations').delete().eq('submission_id', params.submissionId);
  deleteQuery = params.dancerIndex == null ? deleteQuery.is('dancer_index', null) : deleteQuery.eq('dancer_index', params.dancerIndex);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Error(`Failed to clear existing class registrations: ${deleteError.message}`);

  const selections = parseClassSelectionString(params.classRaw);
  if (selections.length === 0) return;

  const priceByTitle = await lookupClassPrices();
  const rows = buildRegistrationRows(params.submissionId, params.dancerIndex, params.dancer, selections, priceByTitle);

  const { error } = await supabase.from('class_registrations').insert(rows);
  if (error) throw new Error(`Failed to insert class registrations: ${error.message}`);
}

export async function getClassRegistrationsForDancer(submissionId: string, dancerIndex: number | null): Promise<ClassRegistrationRow[]> {
  let query = supabase.from('class_registrations').select('*').eq('submission_id', submissionId);
  query = dancerIndex == null ? query.is('dancer_index', null) : query.eq('dancer_index', dancerIndex);
  const { data, error } = await query;
  if (error) {
    console.error('Failed to load class registrations for dancer:', error.message);
    return [];
  }
  return (data ?? []) as ClassRegistrationRow[];
}

export async function getClassRegistrationsForSubmission(submissionId: string): Promise<ClassRegistrationRow[]> {
  const { data, error } = await supabase.from('class_registrations').select('*').eq('submission_id', submissionId);
  if (error) {
    console.error('Failed to load class registrations for submission:', error.message);
    return [];
  }
  return (data ?? []) as ClassRegistrationRow[];
}

export async function deleteClassRegistrationsForDancer(submissionId: string, dancerIndex: number | null): Promise<void> {
  let query = supabase.from('class_registrations').delete().eq('submission_id', submissionId);
  query = dancerIndex == null ? query.is('dancer_index', null) : query.eq('dancer_index', dancerIndex);
  const { error } = await query;
  if (error) throw new Error(`Failed to delete class registrations: ${error.message}`);
}

// Re-inserts previously snapshotted rows verbatim (restore path) — strips the
// old id/created_at so Postgres assigns fresh ones rather than colliding.
export async function insertClassRegistrationSnapshots(rows: ClassRegistrationRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map(({ id, created_at, ...rest }) => rest);
  const { error } = await supabase.from('class_registrations').insert(payload);
  if (error) throw new Error(`Failed to restore class registrations: ${error.message}`);
}

import { supabase } from './supabase';
import { getActivePrice, type PriceTier } from './pricing';

export interface ParsedClassSelection {
  label: string;
  title: string;
  mode: 'whole' | 'dropin' | null;
  // Present when the selection came from the structured `class_selections`
  // field (see parseClassSelectionsJson) — the series' unambiguous
  // `google_recurring_event_id ?? id` key, so two unrelated classes that
  // happen to share a title are never confused with each other. Absent
  // for legacy/admin-edited plain-string selections, which fall back to
  // title-based matching (see lookupClassPrices).
  key?: string;
  // The specific occurrence a Drop-In selection is for, chosen at
  // registration time. Never set for Whole-Series selections.
  occurrenceEventId?: string | null;
}

// Legacy wire format, still used by the admin's free-text signup editor:
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

// Structured wire format submitted alongside the legacy `class` string by
// register.astro / register/events.astro: a JSON array of
// { key, title, label, mode, occurrenceEventId? }. This is what actually
// gets used for price lookup, registration-closed checks, and drop-in
// occurrence storage — the plain-string field above is kept only for
// human display (confirmation page, admin notification emails, the
// deletion-audit snapshot) and as the admin edit-signup fallback.
export function parseClassSelectionsJson(raw: string | null | undefined): ParsedClassSelection[] {
  const value = (raw ?? '').trim();
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ParsedClassSelection[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, title, label, mode, occurrenceEventId } = entry as Record<string, unknown>;
    if (typeof title !== 'string' || !title) continue;
    out.push({
      key: typeof key === 'string' && key ? key : undefined,
      title,
      label: typeof label === 'string' && label ? label : title,
      mode: mode === 'whole' || mode === 'dropin' ? mode : null,
      occurrenceEventId: typeof occurrenceEventId === 'string' && occurrenceEventId ? occurrenceEventId : null,
    });
  }
  return out;
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
  price_tier: PriceTier | null;
  occurrence_event_id: string | null;
  is_drop_in: boolean;
  created_at: string;
}

interface ClassPriceInfo {
  whole: number | null;
  dropIn: number | null;
  student: number | null;
  wholeEarlyBird: number | null;
  dropInEarlyBird: number | null;
  studentEarlyBird: number | null;
  earlyBirdUntil: string | null;
  wholeFlashSale: number | null;
  dropInFlashSale: number | null;
  studentFlashSale: number | null;
  flashSaleUntil: string | null;
}

const PRICE_COLUMNS =
  'id, title, google_recurring_event_id, price_whole_series, price_drop_in, price_student, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until' as const;

// Keyed by both `id` and `google_recurring_event_id` (so a lookup by
// either form of series key resolves), and by `title` as a first-match
// fallback for selections with no key (the admin's free-text edit path).
async function lookupClassPrices(): Promise<Map<string, ClassPriceInfo>> {
  const { data, error } = await supabase.from('events').select(PRICE_COLUMNS).eq('event_type', 'class');
  if (error) console.error('Failed to load class prices for registration snapshot:', error.message);

  const map = new Map<string, ClassPriceInfo>();
  for (const e of data ?? []) {
    const info: ClassPriceInfo = {
      whole: e.price_whole_series,
      dropIn: e.price_drop_in,
      student: e.price_student,
      wholeEarlyBird: e.price_whole_series_early_bird,
      dropInEarlyBird: e.price_drop_in_early_bird,
      studentEarlyBird: e.price_student_early_bird,
      earlyBirdUntil: e.early_bird_until,
      wholeFlashSale: e.price_whole_series_flash_sale,
      dropInFlashSale: e.price_drop_in_flash_sale,
      studentFlashSale: e.price_student_flash_sale,
      flashSaleUntil: e.flash_sale_until,
    };
    map.set(e.id, info);
    if (e.google_recurring_event_id) map.set(e.google_recurring_event_id, info);
    if (!map.has(e.title)) map.set(e.title, info);
  }
  return map;
}

// Server-side backstop mirroring the registration-closed and no-drop-in-
// price UI guards — returns an error message if anything's wrong with the
// submitted selections, or null if they're all fine to register.
export async function validateClassSelections(selections: ParsedClassSelection[]): Promise<string | null> {
  if (selections.length === 0) return null;

  const { data, error } = await supabase.from('events').select('id, google_recurring_event_id, title, registration_closed');
  if (error) {
    console.error('Failed to validate class selections:', error.message);
    return null; // fail open — a validation-lookup bug shouldn't block every registration
  }

  const closedKeys = new Set<string>();
  for (const e of data ?? []) {
    if (!e.registration_closed) continue;
    closedKeys.add(e.id);
    if (e.google_recurring_event_id) closedKeys.add(e.google_recurring_event_id);
    closedKeys.add(e.title);
  }

  for (const sel of selections) {
    if ((sel.key && closedKeys.has(sel.key)) || closedKeys.has(sel.title)) {
      return `Registration for "${sel.title}" is closed — please choose a different class.`;
    }
  }
  return null;
}

function buildRegistrationRows(
  submissionId: string,
  dancerIndex: number | null,
  dancer: DancerLike,
  selections: ParsedClassSelection[],
  priceMap: Map<string, ClassPriceInfo>
) {
  const now = new Date();

  return selections.map((sel) => {
    const info = (sel.key ? priceMap.get(sel.key) : undefined) ?? priceMap.get(sel.title);

    // No drop-in price on file for this class — fall back to whole-series
    // rather than storing a null price (defense in depth; the UI already
    // hides the Drop In option in this case).
    const dropInAvailable = info?.dropIn != null;
    const effectiveMode: ParsedClassSelection['mode'] = sel.mode === 'dropin' && !dropInAvailable ? 'whole' : sel.mode;
    const isDropIn = effectiveMode === 'dropin';

    const priceResult = getActivePrice(now, {
      base: isDropIn ? info?.dropIn ?? null : info?.whole ?? null,
      earlyBird: isDropIn ? info?.dropInEarlyBird ?? null : info?.wholeEarlyBird ?? null,
      earlyBirdUntil: info?.earlyBirdUntil ?? null,
      flashSale: isDropIn ? info?.dropInFlashSale ?? null : info?.wholeFlashSale ?? null,
      flashSaleUntil: info?.flashSaleUntil ?? null,
    });

    return {
      submission_id: submissionId,
      dancer_index: dancerIndex,
      first_name: dancer.firstName ?? '',
      last_name: dancer.lastName ?? '',
      email: dancer.email || null,
      phone: dancer.phone || null,
      class_title: sel.title,
      class_label: sel.label,
      series_mode: effectiveMode,
      price: priceResult.activePrice,
      price_tier: info ? priceResult.tag : null,
      occurrence_event_id: isDropIn ? sel.occurrenceEventId ?? null : null,
      is_drop_in: isDropIn,
    };
  });
}

export function resolveClassSelections(classRaw: string | null | undefined, classSelectionsRaw: string | null | undefined): ParsedClassSelection[] {
  const structured = parseClassSelectionsJson(classSelectionsRaw);
  return structured.length > 0 ? structured : parseClassSelectionString(classRaw);
}

// Snapshots one row per (dancer, class) pair at submission time — price is
// looked up once here and stored, so a later class rename/price change
// doesn't retroactively change what a past registration is shown to owe.
export async function insertClassRegistrations(params: {
  submissionId: string;
  classRaw: string | null;
  classSelectionsRaw?: string | null;
  dancers: DancerLike[] | null;
  fallbackFirstName: string;
  fallbackLastName: string;
  fallbackEmail: string | null;
  fallbackPhone: string | null;
}): Promise<void> {
  const selections = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (selections.length === 0) return;

  const priceMap = await lookupClassPrices();
  const recipients: DancerLike[] =
    params.dancers && params.dancers.length > 0
      ? params.dancers
      : [{ firstName: params.fallbackFirstName, lastName: params.fallbackLastName, email: params.fallbackEmail ?? undefined, phone: params.fallbackPhone ?? undefined }];

  const rows = recipients.flatMap((d, dancerIndex) => buildRegistrationRows(params.submissionId, params.dancers ? dancerIndex : null, d, selections, priceMap));
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
  classSelectionsRaw?: string | null;
  dancer: DancerLike;
}): Promise<void> {
  let deleteQuery = supabase.from('class_registrations').delete().eq('submission_id', params.submissionId);
  deleteQuery = params.dancerIndex == null ? deleteQuery.is('dancer_index', null) : deleteQuery.eq('dancer_index', params.dancerIndex);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Error(`Failed to clear existing class registrations: ${deleteError.message}`);

  const selections = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (selections.length === 0) return;

  const priceMap = await lookupClassPrices();
  const rows = buildRegistrationRows(params.submissionId, params.dancerIndex, params.dancer, selections, priceMap);

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

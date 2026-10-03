import { supabase } from './supabase';
import { getActivePrice, type PriceTier } from './pricing';
import { buildClassSeriesList } from './classSeries';

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
  // The event's own title, used as the stored `class_title` for keyed
  // selections so a client can't pair one series' key with another's title.
  title: string;
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;

// Only loads the rows the selections can actually reference (by id, recurring
// id, or title), so the lookup never scans — or gets truncated by the row cap
// on — the whole events table.
async function lookupClassPrices(selections: ParsedClassSelection[]): Promise<Map<string, ClassPriceInfo>> {
  const keys = Array.from(new Set(selections.map((s) => s.key).filter((k): k is string => !!k && SAFE_KEY_RE.test(k))));
  const ids = keys.filter((k) => UUID_RE.test(k));
  const titles = Array.from(new Set(selections.map((s) => s.title)));

  const base = () => supabase.from('events').select(PRICE_COLUMNS).eq('event_type', 'class');
  const results = await Promise.all([
    ids.length > 0 ? base().in('id', ids) : null,
    keys.length > 0 ? base().in('google_recurring_event_id', keys) : null,
    base().in('title', titles),
  ]);

  const data: NonNullable<(typeof results)[number]>['data'] = [];
  for (const r of results) {
    if (!r) continue;
    if (r.error) console.error('Failed to load class prices for registration snapshot:', r.error.message);
    data!.push(...(r.data ?? []));
  }

  const map = new Map<string, ClassPriceInfo>();
  for (const e of data ?? []) {
    const info: ClassPriceInfo = {
      title: e.title,
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
// submitted selections, or null if they're all fine to register. Fails closed
// (503) if the closed-class lookup errors, since we can't confirm the classes
// are open — better a retry prompt than registering someone for a closed class.
export interface ClassSelectionError {
  message: string;
  status: number;
}

export async function validateClassSelections(selections: ParsedClassSelection[]): Promise<ClassSelectionError | null> {
  if (selections.length === 0) return null;

  const { data, error } = await supabase
    .from('events')
    .select('id, google_recurring_event_id, title, registration_closed')
    .eq('registration_closed', true);
  if (error) {
    console.error('Failed to validate class selections:', error.message);
    return {
      message:
        "We couldn't confirm that these classes are open for registration right now. Please try again in a minute. If it keeps happening, contact us and we'll sign you up.",
      status: 503,
    };
  }

  const closedKeys = new Set<string>();
  for (const e of data ?? []) {
    if (!e.registration_closed) continue;
    closedKeys.add(e.id);
    if (e.google_recurring_event_id) closedKeys.add(e.google_recurring_event_id);
    closedKeys.add(e.title);
  }

  for (const sel of selections) {
    // Title is only a fallback for selections without a key, so an open series sharing a title isn't rejected.
    // Keyed selections are stored under the key's own event title (see buildRegistrationRows), so a
    // mismatched client title can't get a closed class's name onto an open series' registration.
    if (sel.key ? closedKeys.has(sel.key) : closedKeys.has(sel.title)) {
      return { message: `Registration for "${sel.title}" is closed — please choose a different class.`, status: 400 };
    }
  }
  return null;
}

// A Drop-In's occurrenceEventId comes from the client, so keep it only when it
// is a real class event belonging to the selected series; otherwise drop it
// rather than let a bad id fail the FK insert or corrupt attendance data.
async function sanitizeOccurrenceIds(selections: ParsedClassSelection[]): Promise<ParsedClassSelection[]> {
  const ids = Array.from(new Set(selections.map((s) => s.occurrenceEventId).filter((id): id is string => !!id && UUID_RE.test(id))));
  const valid = new Map<string, { id: string; google_recurring_event_id: string | null; title: string }>();
  if (ids.length > 0) {
    const { data, error } = await supabase.from('events').select('id, google_recurring_event_id, title').eq('event_type', 'class').in('id', ids);
    if (error) console.error('Failed to validate occurrence ids:', error.message);
    for (const e of data ?? []) valid.set(e.id, e);
  }

  return selections.map((sel) => {
    const occ = sel.occurrenceEventId ? valid.get(sel.occurrenceEventId) : undefined;
    const belongs = occ && (sel.key ? sel.key === occ.google_recurring_event_id || sel.key === occ.id : sel.title === occ.title);
    return { ...sel, occurrenceEventId: belongs ? sel.occurrenceEventId : null };
  });
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
    const keyInfo = sel.key ? priceMap.get(sel.key) : undefined;
    const info = keyInfo ?? priceMap.get(sel.title);

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
      class_title: keyInfo?.title ?? sel.title,
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
  const parsed = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (parsed.length === 0) return;

  const selections = await sanitizeOccurrenceIds(parsed);
  const priceMap = await lookupClassPrices(selections);
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

  const parsed = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (parsed.length === 0) return;

  const selections = await sanitizeOccurrenceIds(parsed);
  const priceMap = await lookupClassPrices(selections);
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

// A bad admin edit (as opposed to a database failure) — routes report these as 400s.
export class ClassRegistrationInputError extends Error {}

// Updates the dancer details copied onto a dancer's existing class_registrations
// rows in place. Used when only the person's details changed, so the rows keep
// their ids (attendance matches point at them) and their stored drop-in dates.
export async function updateDancerOnClassRegistrations(submissionId: string, dancerIndex: number | null, dancer: DancerLike): Promise<void> {
  let query = supabase
    .from('class_registrations')
    .update({
      first_name: dancer.firstName ?? '',
      last_name: dancer.lastName ?? '',
      email: dancer.email || null,
      phone: dancer.phone || null,
    })
    .eq('submission_id', submissionId);
  query = dancerIndex == null ? query.is('dancer_index', null) : query.eq('dancer_index', dancerIndex);
  const { error } = await query;
  if (error) throw new Error(`Failed to update class registrations: ${error.message}`);
}

export interface DropInOccurrenceUpdate {
  registrationId: string;
  occurrenceEventId: string | null;
}

// Sets which class date each of a dancer's existing Drop-In registrations is
// for. Every update must target one of this dancer's own Drop-In rows and point
// at a class event with the same title, so a bad request can't attach a
// registration to some other class.
export async function setDropInOccurrences(submissionId: string, dancerIndex: number | null, updates: DropInOccurrenceUpdate[]): Promise<void> {
  if (updates.length === 0) return;

  const rows = await getClassRegistrationsForDancer(submissionId, dancerIndex);
  const rowsById = new Map(rows.map((r) => [r.id, r]));

  const eventIds = Array.from(new Set(updates.map((u) => u.occurrenceEventId).filter((id): id is string => !!id)));
  if (eventIds.some((id) => !UUID_RE.test(id))) throw new ClassRegistrationInputError('That class date is not valid.');

  const titleByEventId = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data, error } = await supabase.from('events').select('id, title').eq('event_type', 'class').in('id', eventIds);
    if (error) throw new Error(`Failed to look up class dates: ${error.message}`);
    for (const e of data ?? []) titleByEventId.set(e.id, e.title);
  }

  for (const update of updates) {
    const reg = rowsById.get(update.registrationId);
    if (!reg || reg.series_mode !== 'dropin') {
      throw new ClassRegistrationInputError('Only a dancer\'s own Drop-In registrations can have a class date set.');
    }
    if (update.occurrenceEventId && titleByEventId.get(update.occurrenceEventId) !== reg.class_title) {
      throw new ClassRegistrationInputError(`That date isn't one of the "${reg.class_title}" classes.`);
    }
  }

  for (const update of updates) {
    const { error } = await supabase.from('class_registrations').update({ occurrence_event_id: update.occurrenceEventId }).eq('id', update.registrationId);
    if (error) throw new Error(`Failed to update the class date: ${error.message}`);
  }
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

export type CheckinRegistrationResult = 'created' | 'exists' | 'skipped';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Used by the admin check-in QR's "also register" option for drop-in-only
// events, so attendees who never pre-registered don't all land in the
// orphaned-check-ins queue. Creates a one-class sign-up (unpaid, no payment
// method — it shows in Sign-Ups for the admin to collect/mark paid) for the
// specific occurrence the person checked in to.
//
// Skipped (never an error — the check-in itself always goes through) when the
// event doesn't exist, registration is closed, or it has no drop-in price. Does
// nothing if the same name is already registered for this class — a drop-in for
// this occurrence, or a whole-series sign-up — so a pre-registered attendee
// just matches their existing registration.
export async function createCheckinDropInRegistration(params: {
  eventId: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<CheckinRegistrationResult> {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(`${PRICE_COLUMNS}, start_time, end_time, registration_closed`)
    .eq('id', params.eventId)
    .maybeSingle();
  if (eventError || !event || event.registration_closed || event.price_drop_in == null) return 'skipped';

  const { data: existing, error: existingError } = await supabase
    .from('class_registrations')
    .select('series_mode, occurrence_event_id')
    .eq('class_title', event.title)
    .ilike('first_name', escapeLike(params.firstName))
    .ilike('last_name', escapeLike(params.lastName));
  if (existingError) {
    console.error('Failed to check for an existing registration:', existingError.message);
    return 'skipped';
  }
  if ((existing ?? []).some((r) => r.series_mode !== 'dropin' || r.occurrence_event_id === event.id)) return 'exists';

  // Same label the registration form stores: "<title> — <schedule>", where a
  // recurring class's schedule describes the whole series rather than one date.
  const siblings = event.google_recurring_event_id
    ? (
        await supabase
          .from('events')
          .select('id, title, start_time, end_time, google_recurring_event_id')
          .eq('google_recurring_event_id', event.google_recurring_event_id)
      ).data ?? []
    : [];
  const [series] = buildClassSeriesList(siblings.length > 0 ? siblings : [event], siblings.length > 0 ? siblings : [event]);
  const label = `${event.title} — ${series?.subLabel ?? ''}`.replace(/ — $/, '');

  const { data: submission, error: submissionError } = await supabase
    .from('intake_submissions')
    .insert({
      registration_type: 'group',
      first_name: params.firstName,
      last_name: params.lastName,
      email: null,
      phone: params.phone || null,
      class: `${label} — Drop In`,
      payment_method: null,
      paid: false,
      dancers: null,
    })
    .select('id')
    .single();
  if (submissionError || !submission) {
    console.error('Failed to create check-in sign-up:', submissionError?.message);
    return 'skipped';
  }

  const price = getActivePrice(new Date(), {
    base: event.price_drop_in,
    earlyBird: event.price_drop_in_early_bird ?? null,
    earlyBirdUntil: event.early_bird_until ?? null,
    flashSale: event.price_drop_in_flash_sale ?? null,
    flashSaleUntil: event.flash_sale_until ?? null,
  });

  const { error: registrationError } = await supabase.from('class_registrations').insert({
    submission_id: submission.id,
    dancer_index: null,
    first_name: params.firstName,
    last_name: params.lastName,
    email: null,
    phone: params.phone || null,
    class_title: event.title,
    class_label: label,
    series_mode: 'dropin',
    price: price.activePrice,
    price_tier: price.tag,
    occurrence_event_id: event.id,
    is_drop_in: true,
  });
  if (registrationError) {
    console.error('Failed to create check-in registration:', registrationError.message);
    // Don't leave a class-less sign-up behind.
    await supabase.from('intake_submissions').delete().eq('id', submission.id);
    return 'skipped';
  }
  return 'created';
}

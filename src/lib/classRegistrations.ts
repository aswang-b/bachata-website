import { supabase } from './supabase';
import { publicVisibilities } from './testMode';
import { getActivePrice, type PriceTier } from './pricing';
import { buildClassSeriesList } from './classSeries';
import { applyDeals, type Deal } from './deals';
import { dealBundleSizes, listActiveDeals } from './dealsStore';
import { lateRegistrationCutoffIso, registrationOpen } from './eventTimes';

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
    // register.astro sends just the schedule as the label ("Sundays, 1:00 PM…");
    // store "<title> — <schedule>" like every other path so the label stands alone.
    const labelText = typeof label === 'string' ? label.trim() : '';
    out.push({
      key: typeof key === 'string' && key ? key : undefined,
      title,
      label: !labelText ? title : labelText.startsWith(title) ? labelText : `${title} — ${labelText}`,
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
  // The bundle deal this class got (migration 0047): its name, and its share
  // of the discount (already taken off `price`).
  deal_id?: string | null;
  deal_name?: string | null;
  deal_discount?: number | null;
  created_at: string;
}

interface ClassPriceInfo {
  eventType: EventType;
  // The event's own title, used as the stored `class_title` for keyed
  // selections so a client can't pair one series' key with another's title.
  title: string;
  // The series key (`google_recurring_event_id ?? id`), stored on each
  // registration so capacity can be counted per series.
  seriesKey: string;
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
  'id, title, event_type, google_recurring_event_id, price_whole_series, price_drop_in, price_student, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until' as const;

// Keyed by both `id` and `google_recurring_event_id` (so a lookup by
// either form of series key resolves), and by `title` as a first-match
// fallback for selections with no key (the admin's free-text edit path).
// The title fallback only matches `titleType` (classes, unless it's an event
// sign-up), so a class and an event that share a title are never confused.
type EventType = 'class' | 'event';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;

// Only loads the rows the selections can actually reference (by id, recurring
// id, or title), so the lookup never scans — or gets truncated by the row cap
// on — the whole events table.
async function lookupClassPrices(selections: ParsedClassSelection[], titleType: EventType = 'class'): Promise<Map<string, ClassPriceInfo>> {
  const keys = Array.from(new Set(selections.map((s) => s.key).filter((k): k is string => !!k && SAFE_KEY_RE.test(k))));
  const ids = keys.filter((k) => UUID_RE.test(k));
  const titles = Array.from(new Set(selections.map((s) => s.title)));

  // Classes and events alike: an event's ticket price is its whole-series price.
  const base = () => supabase.from('events').select(PRICE_COLUMNS);
  const results = await Promise.all([
    ids.length > 0 ? base().in('id', ids) : null,
    keys.length > 0 ? base().in('google_recurring_event_id', keys) : null,
    base().eq('event_type', titleType).in('title', titles),
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
      eventType: e.event_type === 'event' ? 'event' : 'class',
      title: e.title,
      seriesKey: e.google_recurring_event_id ?? e.id,
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
    if (e.event_type === titleType && !map.has(e.title)) map.set(e.title, info);
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
    // And the reverse: a class with only a drop-in price (no whole/flat price)
    // can only ever be a drop-in, whatever mode the client sent.
    const dropInOnly = dropInAvailable && info?.whole == null;
    // An event sells one ticket at its whole-series price, as the form shows
    // it (the editor has no drop-in price for events; one left over from when
    // it was a class is ignored), so it's never a drop-in and counts toward deals.
    const isEventTicket = info?.eventType === 'event';
    const effectiveMode: ParsedClassSelection['mode'] = isEventTicket
      ? null
      : dropInOnly
        ? 'dropin'
        : sel.mode === 'dropin' && !dropInAvailable
          ? 'whole'
          : sel.mode;
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
      series_key: info?.seriesKey ?? null,
      series_mode: effectiveMode,
      price: priceResult.activePrice,
      price_tier: info ? priceResult.tag : null,
      occurrence_event_id: isDropIn ? sel.occurrenceEventId ?? null : null,
      is_drop_in: isDropIn,
      deal_id: null as string | null,
      deal_name: null as string | null,
      deal_discount: null as number | null,
    };
  });
}

export type RegistrationRow = Omit<ReturnType<typeof buildRegistrationRows>[number], 'submission_id'>;

type DealPricedRow = Pick<RegistrationRow, 'dancer_index' | 'series_key' | 'price' | 'is_drop_in' | 'deal_id' | 'deal_name' | 'deal_discount'>;

// Takes each dancer's bundle deals off their rows' prices (see deals.ts),
// recording the deal on each discounted row. Rows that already carry a deal
// (kept from before an admin edit) are left as they are. Mutates and returns the rows.
export function applyDealsToRows<T extends DealPricedRow>(rows: T[], deals: Deal[]): T[] {
  if (deals.length === 0) return rows;
  const byDancer = new Map<number | null, T[]>();
  for (const row of rows) byDancer.set(row.dancer_index, [...(byDancer.get(row.dancer_index) ?? []), row]);
  for (const dancerRows of byDancer.values()) {
    const { discounts } = applyDeals(
      dancerRows.map((r) => ({ key: r.series_key ?? '', price: r.price, eligible: !r.is_drop_in && Boolean(r.series_key) && !r.deal_name })),
      deals
    );
    dancerRows.forEach((row, i) => {
      const d = discounts[i];
      if (!d || row.price == null) return;
      row.price = Math.round((row.price - d.amount) * 100) / 100;
      row.deal_id = d.dealId;
      row.deal_name = d.dealName;
      row.deal_discount = d.amount;
    });
  }
  return rows;
}

// A public sign-up can only book what the form offers: a public class (or
// event) with a date still to come, and for a Drop-In, a date still to come.
// Otherwise a direct POST could book a private-calendar class (and see its
// title on the confirmation) or a past date, which capacity never counts.
async function findUnbookable(rows: RegistrationRow[]): Promise<ClassSelectionError | null> {
  const seriesKeys = Array.from(new Set(rows.map((r) => r.series_key).filter((k): k is string => !!k)));
  const ids = seriesKeys.filter((k) => UUID_RE.test(k));
  // Still open: anything that hasn't started, plus an event until 30 minutes
  // after it ends (door sign-ups; registrationOpen has the rule).
  const now = new Date().toISOString();
  const columns = 'id, google_recurring_event_id, event_type, start_time, end_time';
  const upcoming = () => supabase.from('events').select(columns).in('visibility', publicVisibilities()).gte('start_time', now);
  const atTheDoor = () => supabase.from('events').select(columns).in('visibility', publicVisibilities()).eq('event_type', 'event').lt('start_time', now).gte('end_time', lateRegistrationCutoffIso());
  const results = await Promise.all([
    ids.length > 0 ? upcoming().in('id', ids) : null,
    upcoming().in('google_recurring_event_id', seriesKeys),
    ids.length > 0 ? atTheDoor().in('id', ids) : null,
    atTheDoor().in('google_recurring_event_id', seriesKeys),
  ]);

  const upcomingSeries = new Set<string>();
  const upcomingIds = new Set<string>();
  for (const r of results) {
    if (!r) continue;
    if (r.error) {
      console.error('Failed to check classes are bookable:', r.error.message);
      return { message: "We couldn't confirm these classes are open for registration right now. Please try again in a minute.", status: 503 };
    }
    for (const e of r.data ?? []) {
      if (!registrationOpen(e)) continue;
      upcomingSeries.add(e.google_recurring_event_id ?? e.id);
      upcomingIds.add(e.id);
    }
  }

  for (const row of rows) {
    if (!row.series_key || !upcomingSeries.has(row.series_key)) {
      return { message: `"${row.class_title}" isn't open for registration. Please reload the page and pick again.`, status: 400 };
    }
    if (row.occurrence_event_id && !upcomingIds.has(row.occurrence_event_id)) {
      return { message: `That "${row.class_title}" date has already passed. Please pick another date.`, status: 400 };
    }
  }
  return null;
}

// The class_registrations rows a public sign-up will save (one per dancer per
// class; register_submission in migration 0046 fills in submission_id and
// enforces capacity on them), or why they can't be saved. Checked on the
// resolved rows rather than on what the browser sent: every selection must be
// a real class (on the events form, an event), and every class Drop-In must
// name one of its own series' dates, so every row counts toward a capacity.
// hasCost: whether any of it costs money right now, priced exactly as the
// rows are, so a paid event needs a payment method (the form only asks then).
export async function prepareRegistrationRows(
  selections: ParsedClassSelection[],
  eventType: EventType,
  dancers: DancerLike[]
): Promise<{ rows: RegistrationRow[]; hasCost: boolean } | { error: ClassSelectionError }> {
  // Independent reads, loaded together (sanitizing only touches the Drop-In
  // dates, never the keys and titles prices are looked up by).
  const [sanitized, priceMap, deals] = await Promise.all([
    sanitizeOccurrenceIds(selections),
    lookupClassPrices(selections, eventType),
    listActiveDeals(),
  ]);

  for (const sel of sanitized) {
    const info = priceMap.get(sel.key ?? sel.title);
    if (!info || info.eventType !== eventType) {
      return { error: { message: `We couldn't find the ${eventType} "${sel.title}". Please reload the page and pick again.`, status: 400 } };
    }
  }

  const perDancer = buildRegistrationRows('', null, {}, sanitized, priceMap);
  const undated = eventType === 'class' ? perDancer.find((r) => r.is_drop_in && !r.occurrence_event_id) : undefined;
  if (undated) {
    return { error: { message: `Please pick which "${undated.class_title}" class you're dropping into.`, status: 400 } };
  }
  const unbookable = await findUnbookable(perDancer);
  if (unbookable) return { error: unbookable };

  const rows = applyDealsToRows(
    dancers.flatMap((d, i) => buildRegistrationRows('', i, d, sanitized, priceMap).map(({ submission_id: _, ...row }) => row)),
    deals
  );
  return { rows, hasCost: rows.some((r) => (r.price ?? 0) > 0) };
}

export function resolveClassSelections(classRaw: string | null | undefined, classSelectionsRaw: string | null | undefined): ParsedClassSelection[] {
  const structured = parseClassSelectionsJson(classSelectionsRaw);
  return structured.length > 0 ? structured : parseClassSelectionString(classRaw);
}

// Snapshots one row per (dancer, class) pair at submission time — price is
// looked up once here and stored, so a later class rename/price change
// doesn't retroactively change what a past registration is shown to owe.
// Throws if the rows can't be saved, so the caller doesn't report success.
export async function insertClassRegistrations(params: {
  submissionId: string;
  classRaw: string | null;
  classSelectionsRaw?: string | null;
  dancers: DancerLike[] | null;
  fallbackFirstName: string;
  fallbackLastName: string;
  fallbackEmail: string | null;
  fallbackPhone: string | null;
  eventType?: EventType;
}): Promise<void> {
  const parsed = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (parsed.length === 0) return;

  const selections = await sanitizeOccurrenceIds(parsed);
  const priceMap = await lookupClassPrices(selections, params.eventType);
  const recipients: DancerLike[] =
    params.dancers && params.dancers.length > 0
      ? params.dancers
      : [{ firstName: params.fallbackFirstName, lastName: params.fallbackLastName, email: params.fallbackEmail ?? undefined, phone: params.fallbackPhone ?? undefined }];

  const rows = applyDealsToRows(
    recipients.flatMap((d, dancerIndex) => buildRegistrationRows(params.submissionId, params.dancers ? dancerIndex : null, d, selections, priceMap)),
    await listActiveDeals()
  );
  if (rows.length === 0) return;

  const { error } = await supabase.from('class_registrations').insert(rows);
  if (error) throw new Error(`Failed to save the class registrations: ${error.message}`);
}

type SavedPricing = Pick<ClassRegistrationRow, 'series_mode' | 'occurrence_event_id' | 'price' | 'price_tier' | 'deal_id' | 'deal_name' | 'deal_discount'> & { series_key: string | null };
type RebuiltRow = ReturnType<typeof buildRegistrationRows>[number];

// An admin edit rebuilds a dancer's rows; a class they already had (same
// series, option and date) keeps the price and deal it was saved with, so an
// edit never re-prices what didn't change (an early bird that has since
// ended, a deal that has since ended or been paused). A deal only stays while
// the dancer still has every class it covered; otherwise the classes left go
// back to the full price they were saved at. An "any N" deal can apply more
// than once (6 workshops on "any 3" are two bundles), so `bundleSizes` (deal
// id → N) lets the whole bundles that are left keep it; only the broken
// one's classes go back to full price. Mutates and returns the rows.
export function carryOverPricing<T extends RebuiltRow>(rows: T[], saved: SavedPricing[], bundleSizes: Map<string, number> = new Map()): T[] {
  const matchKey = (r: Pick<SavedPricing, 'series_key' | 'series_mode' | 'occurrence_event_id'>) => [r.series_key, r.series_mode, r.occurrence_event_id ?? ''].join('|');
  const unused = [...saved];
  const kept = new Map<T, SavedPricing>();
  for (const row of rows) {
    const i = unused.findIndex((s) => matchKey(s) === matchKey(row));
    if (i === -1) continue;
    kept.set(row, unused[i]);
    unused.splice(i, 1);
  }
  const dealGroup = (s: SavedPricing) => `${s.deal_id ?? ''}|${s.deal_name}`;
  const brokenDeals = new Set(unused.filter((s) => s.deal_name).map(dealGroup));
  // For a broken repeating deal: how many of its kept classes still make up whole bundles.
  const stillWhole = new Map<string, number>();
  for (const group of brokenDeals) {
    const keptInGroup = [...kept.values()].filter((s) => s.deal_name && dealGroup(s) === group);
    const size = keptInGroup[0]?.deal_id ? bundleSizes.get(keptInGroup[0].deal_id) : undefined;
    stillWhole.set(group, size ? Math.floor(keptInGroup.length / size) * size : 0);
  }
  for (const [row, s] of kept) {
    row.price_tier = s.price_tier;
    const group = dealGroup(s);
    const keepsDeal = Boolean(s.deal_name) && (!brokenDeals.has(group) || (stillWhole.get(group) ?? 0) > 0);
    if (s.deal_name && brokenDeals.has(group) && keepsDeal) stillWhole.set(group, stillWhole.get(group)! - 1);
    if (keepsDeal && s.deal_name) {
      row.price = s.price;
      row.deal_id = s.deal_id ?? null;
      row.deal_name = s.deal_name;
      row.deal_discount = s.deal_discount ?? null;
    } else {
      row.price = s.price != null ? Math.round((s.price + (s.deal_discount ?? 0)) * 100) / 100 : null;
    }
  }
  return rows;
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
  eventType?: EventType;
}): Promise<void> {
  // What the dancer's current classes were saved at, so unchanged ones keep it.
  let savedQuery = supabase
    .from('class_registrations')
    .select('series_key, series_mode, occurrence_event_id, price, price_tier, deal_id, deal_name, deal_discount')
    .eq('submission_id', params.submissionId)
    .is('deleted_at', null);
  savedQuery = params.dancerIndex == null ? savedQuery.is('dancer_index', null) : savedQuery.eq('dancer_index', params.dancerIndex);
  const { data: saved, error: savedError } = await savedQuery;
  if (savedError) throw new Error(`Failed to load existing class registrations: ${savedError.message}`);

  // Rows in the Recycling Bin aren't the dancer's current classes; leave them for a restore.
  let deleteQuery = supabase.from('class_registrations').delete().eq('submission_id', params.submissionId).is('deleted_at', null);
  deleteQuery = params.dancerIndex == null ? deleteQuery.is('dancer_index', null) : deleteQuery.eq('dancer_index', params.dancerIndex);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Error(`Failed to clear existing class registrations: ${deleteError.message}`);

  const parsed = resolveClassSelections(params.classRaw, params.classSelectionsRaw);
  if (parsed.length === 0) return;

  const selections = await sanitizeOccurrenceIds(parsed);
  const priceMap = await lookupClassPrices(selections, params.eventType);
  const savedRows = (saved ?? []) as SavedPricing[];
  const [bundleSizes, activeDeals] = await Promise.all([dealBundleSizes(savedRows.flatMap((s) => (s.deal_id ? [s.deal_id] : []))), listActiveDeals()]);
  const rows = applyDealsToRows(
    carryOverPricing(buildRegistrationRows(params.submissionId, params.dancerIndex, params.dancer, selections, priceMap), savedRows, bundleSizes),
    activeDeals
  );

  const { error } = await supabase.from('class_registrations').insert(rows);
  if (error) throw new Error(`Failed to insert class registrations: ${error.message}`);
}

// Live rows only: ones in the Recycling Bin aren't the dancer's classes.
export async function getClassRegistrationsForDancer(submissionId: string, dancerIndex: number | null): Promise<ClassRegistrationRow[]> {
  let query = supabase.from('class_registrations').select('*').eq('submission_id', submissionId).is('deleted_at', null);
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
    .eq('submission_id', submissionId)
    .is('deleted_at', null);
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
    .is('deleted_at', null)
    .ilike('first_name', escapeLike(params.firstName))
    .ilike('last_name', escapeLike(params.lastName));
  if (existingError) {
    console.error('Failed to check for an existing registration:', existingError.message);
    return 'skipped';
  }
  if ((existing ?? []).some((r) => r.series_mode !== 'dropin' || r.occurrence_event_id === event.id)) return 'exists';

  const registrationId = await insertDropInSignup(event, { ...params, email: null });
  return registrationId ? 'created' : 'skipped';
}

interface DropInEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  google_recurring_event_id: string | null;
  price_drop_in: number | null;
  price_drop_in_early_bird?: number | null;
  early_bird_until?: string | null;
  price_drop_in_flash_sale?: number | null;
  flash_sale_until?: string | null;
}

// Creates a one-class Drop-In sign-up (unpaid, no payment method) for one
// specific occurrence and returns the new class_registrations id, or null on
// failure (never leaving a class-less sign-up behind).
async function insertDropInSignup(
  event: DropInEvent,
  person: { firstName: string; lastName: string; phone: string | null; email: string | null }
): Promise<string | null> {
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
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email || null,
      phone: person.phone || null,
      class: `${label} — Drop In`,
      payment_method: null,
      paid: false,
      dancers: null,
    })
    .select('id')
    .single();
  if (submissionError || !submission) {
    console.error('Failed to create drop-in sign-up:', submissionError?.message);
    return null;
  }

  const price = getActivePrice(new Date(), {
    base: event.price_drop_in,
    earlyBird: event.price_drop_in_early_bird ?? null,
    earlyBirdUntil: event.early_bird_until ?? null,
    flashSale: event.price_drop_in_flash_sale ?? null,
    flashSaleUntil: event.flash_sale_until ?? null,
  });

  const { data: registration, error: registrationError } = await supabase
    .from('class_registrations')
    .insert({
      submission_id: submission.id,
      dancer_index: null,
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email || null,
      phone: person.phone || null,
      class_title: event.title,
      class_label: label,
      series_key: event.google_recurring_event_id ?? event.id,
      series_mode: 'dropin',
      price: price.activePrice,
      price_tier: price.tag,
      occurrence_event_id: event.id,
      is_drop_in: true,
    })
    .select('id')
    .single();
  if (registrationError || !registration) {
    console.error('Failed to create drop-in registration:', registrationError?.message);
    // Don't leave a class-less sign-up behind.
    await supabase.from('intake_submissions').delete().eq('id', submission.id);
    return null;
  }
  return registration.id;
}

// Used by the attendance workqueue's "Create Sign-Up" action on an orphaned
// check-in. Unlike the QR path above, the admin chose to do this, so it
// ignores registration_closed and a missing drop-in price (the sign-up then
// just has no price). Returns the new class_registrations id.
export async function createAdminDropInRegistration(params: {
  eventId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}): Promise<string> {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(`${PRICE_COLUMNS}, start_time, end_time`)
    .eq('id', params.eventId)
    .eq('event_type', 'class')
    .maybeSingle();
  if (eventError || !event) throw new ClassRegistrationInputError('That class could not be found — please pick again.');

  const registrationId = await insertDropInSignup(event, params);
  if (!registrationId) throw new Error('Failed to create the sign-up.');
  return registrationId;
}

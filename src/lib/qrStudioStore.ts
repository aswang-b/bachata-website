import { supabase } from './supabase';
import { fakeQrServices } from './testMode';
import type { VenmoAccount } from './venmo';

// What the door sign (/admin/qr) remembers: its short link and branded code on
// qr.dancewithb.fun, where it was last pointed, and the Venmo accounts it can
// show. One JSON value on site_config (migration 0068). The test suite keeps
// it in memory instead (E2E_FAKE_QR), so a run never touches the real one.

export interface SavedVenmo extends VenmoAccount {
  // How the sign names them, e.g. "Dance with B"; their Venmo name when blank.
  label: string;
}

export interface QrStudio {
  checkin: {
    code: string;
    short: string;
    designId: number | null;
    pointedUrl: string | null;
    pointedLabel: string | null;
    pointedAt: string | null;
    // The classes it opens, so the sign names those and not whatever is picked.
    pointedEventIds?: string[];
    pointedTitles?: string[];
  } | null;
  venmo: SavedVenmo[];
  // Username of the account the sign starts with.
  defaultVenmo: string | null;
}

// Dance with B's own account, from the Venmo code the registration page shows (public/venmo-qr.png).
export const DANCE_WITH_B_VENMO: SavedVenmo = { username: 'amumira', name: 'B Zh', userId: '2024335518728192092', picture: null, label: 'Dance with B' };

const empty = (): QrStudio => ({ checkin: null, venmo: [DANCE_WITH_B_VENMO], defaultVenmo: DANCE_WITH_B_VENMO.username });
let memory: QrStudio | null = null;

export class QrStudioStoreError extends Error {}

// Dance with B is only filled in before anything was saved: a list emptied
// on purpose stays empty, and a cleared default stays cleared.
export function normalize(raw: unknown): QrStudio {
  const v = (raw ?? {}) as Partial<QrStudio>;
  const base = empty();
  const hasVenmo = Array.isArray(v.venmo);
  return {
    checkin: v.checkin && typeof v.checkin.code === 'string' ? v.checkin : null,
    venmo: hasVenmo ? v.venmo! : base.venmo,
    defaultVenmo: typeof v.defaultVenmo === 'string' ? v.defaultVenmo : hasVenmo ? null : base.defaultVenmo,
  };
}

// The stored value as read, so a save can check nobody changed it since.
interface Loaded {
  studio: QrStudio;
  saved: boolean;
  raw: unknown;
  rowExists: boolean;
}

async function load(): Promise<Loaded> {
  if (fakeQrServices()) return { studio: structuredClone(memory ?? empty()), saved: true, raw: null, rowExists: true };
  const { data, error } = await supabase.from('site_config').select('qr_studio').eq('id', true).maybeSingle();
  if (error) {
    if (/qr_studio/.test(error.message)) return { studio: empty(), saved: false, raw: null, rowExists: false };
    throw new QrStudioStoreError(`Couldn't load the QR settings: ${error.message}`);
  }
  const raw = data?.qr_studio ?? null;
  return { studio: normalize(structuredClone(raw)), saved: true, raw, rowExists: Boolean(data) };
}

// `saved: false` before migration 0068 (nothing can be remembered yet).
export async function loadQrStudio(): Promise<{ studio: QrStudio; saved: boolean }> {
  const { studio, saved } = await load();
  return { studio, saved };
}

const saveError = (message: string) => {
  const hint = /qr_studio/.test(message) ? ' Run migration 0068 in Supabase first.' : '';
  return new QrStudioStoreError(`Couldn't save the QR settings: ${message}.${hint}`);
};

// Saves only if the stored value is still `before`; false when someone else saved first.
async function saveIfUnchanged(studio: QrStudio, before: Loaded): Promise<boolean> {
  if (fakeQrServices()) {
    memory = structuredClone(studio);
    return true;
  }
  if (!before.rowExists) {
    const { error } = await supabase.from('site_config').insert({ id: true, qr_studio: { ...studio, rev: crypto.randomUUID() } });
    if (error?.code === '23505') return false;
    if (error) throw saveError(error.message);
    return true;
  }
  // Each save stamps a new `rev`; the update only lands if the stamp read is still there.
  const rev = (before.raw as { rev?: unknown } | null)?.rev;
  let query = supabase.from('site_config').update({ qr_studio: { ...studio, rev: crypto.randomUUID() } }).eq('id', true);
  query = typeof rev === 'string' ? query.eq('qr_studio->>rev', rev) : before.raw === null ? query.is('qr_studio', null) : query.is('qr_studio->>rev', null);
  const { data, error } = await query.select('id');
  if (error) throw saveError(error.message);
  return Array.isArray(data) && data.length > 0;
}

const ATTEMPTS = 4;

// Load, change and save in one step. Two admins acting at once never undo
// each other: when the value changed underneath, it loads again and reapplies
// the change (so `change` must work from whatever it's given).
export async function updateQrStudio(change: (studio: QrStudio) => void): Promise<QrStudio> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const before = await load();
    if (!before.saved) throw saveError('there is no qr_studio column yet');
    const studio = structuredClone(before.studio);
    change(studio);
    if (await saveIfUnchanged(studio, before)) return studio;
  }
  throw new QrStudioStoreError('The QR settings kept changing while saving. Try again.');
}

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

function normalize(raw: unknown): QrStudio {
  const v = (raw ?? {}) as Partial<QrStudio>;
  const base = empty();
  return {
    checkin: v.checkin && typeof v.checkin.code === 'string' ? v.checkin : null,
    venmo: Array.isArray(v.venmo) && v.venmo.length ? v.venmo : base.venmo,
    defaultVenmo: typeof v.defaultVenmo === 'string' ? v.defaultVenmo : base.defaultVenmo,
  };
}

// `saved: false` before migration 0068 (nothing can be remembered yet).
export async function loadQrStudio(): Promise<{ studio: QrStudio; saved: boolean }> {
  if (fakeQrServices()) return { studio: structuredClone(memory ?? empty()), saved: true };
  const { data, error } = await supabase.from('site_config').select('qr_studio').eq('id', true).maybeSingle();
  if (error) {
    if (/qr_studio/.test(error.message)) return { studio: empty(), saved: false };
    throw new QrStudioStoreError(`Couldn't load the QR settings: ${error.message}`);
  }
  return { studio: normalize(data?.qr_studio), saved: true };
}

export async function saveQrStudio(studio: QrStudio): Promise<void> {
  if (fakeQrServices()) {
    memory = structuredClone(studio);
    return;
  }
  const { error } = await supabase.from('site_config').upsert({ id: true, qr_studio: studio });
  if (error) {
    const hint = /qr_studio/.test(error.message) ? ' Run migration 0068 in Supabase first.' : '';
    throw new QrStudioStoreError(`Couldn't save the QR settings: ${error.message}.${hint}`);
  }
}

// Load, change and save in one step.
export async function updateQrStudio(change: (studio: QrStudio) => void): Promise<QrStudio> {
  const { studio } = await loadQrStudio();
  change(studio);
  await saveQrStudio(studio);
  return studio;
}

import { supabase } from './supabase';
import { fakeQrServices } from './testMode';
import { createLink, listLinks, type ShortLink } from './brandedQr';

// Saved door signs (/admin/qr; migration 0071). Each has its own short link on
// qr.dancewithb.fun, taken from a pool: links this site made with the keys
// door-sign-1, door-sign-2, … (plus the first check-in link, made before keys
// existed). Deleting a sign frees its link for the next one. The test suite
// keeps signs in memory (E2E_FAKE_QR).

export interface SignVenmo {
  username: string;
  name: string;
  userId: string;
  label: string;
}

export interface DoorSign {
  id: string;
  created_at: string;
  updated_at: string;
  heading: string;
  event_ids: string[];
  titles: string[];
  create_registration: boolean;
  show_classes: boolean;
  venmo: SignVenmo | null;
  link_code: string;
  link_short: string;
  pointed_url: string | null;
}

export type SignFields = Pick<DoorSign, 'heading' | 'event_ids' | 'titles' | 'create_registration' | 'show_classes' | 'venmo'>;

export class DoorSignError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export const MAX_SIGNS = 40;
const KEY = /^door-sign-(\d+)$/;
// The first check-in link was made with this label, before links had keys.
export const LEGACY_LABEL = 'Class check-in (dancewithb.fun door sign)';
const POOL_LABEL = 'Door sign (dancewithb.fun)';

const memory: DoorSign[] = [];
const storeError = (message: string) => new DoorSignError(`Couldn't reach the saved signs: ${message}.${/door_signs/.test(message) ? ' Run migration 0071 in Supabase first.' : ''}`, 500);

export async function listSigns(): Promise<DoorSign[]> {
  if (fakeQrServices()) return [...memory].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const { data, error } = await supabase.from('door_signs').select('*').order('updated_at', { ascending: false }).limit(MAX_SIGNS);
  if (error) throw storeError(error.message);
  return (data ?? []) as DoorSign[];
}

export async function getSign(id: string): Promise<DoorSign | null> {
  if (fakeQrServices()) return memory.find((s) => s.id === id) ?? null;
  const { data, error } = await supabase.from('door_signs').select('*').eq('id', id).maybeSingle();
  if (error) throw storeError(error.message);
  return (data as DoorSign | null) ?? null;
}

// False when the link was taken by another sign at the same moment (its index is unique).
export async function insertSign(fields: SignFields & Pick<DoorSign, 'link_code' | 'link_short' | 'pointed_url'>): Promise<DoorSign | null> {
  const now = new Date().toISOString();
  if (fakeQrServices()) {
    if (memory.some((s) => s.link_code === fields.link_code)) return null;
    const sign = { ...fields, id: crypto.randomUUID(), created_at: now, updated_at: now };
    memory.push(sign);
    return sign;
  }
  const { data, error } = await supabase.from('door_signs').insert(fields).select('*').single();
  if (error?.code === '23505') return null;
  if (error) throw storeError(error.message);
  return data as DoorSign;
}

export async function updateSign(id: string, fields: Partial<SignFields> & { pointed_url?: string | null }): Promise<DoorSign> {
  const now = new Date().toISOString();
  if (fakeQrServices()) {
    const sign = memory.find((s) => s.id === id);
    if (!sign) throw new DoorSignError('That sign was deleted.', 404);
    Object.assign(sign, fields, { updated_at: now });
    return { ...sign };
  }
  const { data, error } = await supabase.from('door_signs').update({ ...fields, updated_at: now }).eq('id', id).select('*').maybeSingle();
  if (error) throw storeError(error.message);
  if (!data) throw new DoorSignError('That sign was deleted.', 404);
  return data as DoorSign;
}

export async function deleteSign(id: string): Promise<void> {
  if (fakeQrServices()) {
    const at = memory.findIndex((s) => s.id === id);
    if (at >= 0) memory.splice(at, 1);
    return;
  }
  const { error } = await supabase.from('door_signs').delete().eq('id', id);
  if (error) throw storeError(error.message);
}

// ---- The pool of short links ----

export const isPoolLink = (l: Pick<ShortLink, 'key' | 'label'>) => Boolean(l.key && KEY.test(l.key)) || (!l.key && l.label === LEGACY_LABEL);
const keyNumber = (l: ShortLink) => Number(l.key?.match(KEY)?.[1] ?? 0);

// The pool's links, oldest first, and which of them no saved sign uses
// (`signs`: the saved signs, when the caller already has them).
export async function poolLinks(known?: Pick<DoorSign, 'link_code'>[]): Promise<{ links: ShortLink[]; free: ShortLink[] }> {
  const [links, signs] = await Promise.all([listLinks(), known ?? listSigns()]);
  const pool = links.filter(isPoolLink).sort((a, b) => keyNumber(a) - keyNumber(b) || a.created_at - b.created_at);
  const used = new Set(signs.map((s) => s.link_code));
  return { links: pool, free: pool.filter((l) => !used.has(l.code)) };
}

// A new link for the pool, with the next key. A key that already exists comes
// back as it is, so a retry never makes a second link.
export async function addPoolLink(url: string, links: ShortLink[]): Promise<ShortLink> {
  const next = Math.max(0, ...links.map(keyNumber)) + 1;
  return createLink(url, POOL_LABEL, `door-sign-${next}`);
}

// Free links to keep ready, so a batch of branded codes covers the next new signs too.
export const SPARE_LINKS = 2;

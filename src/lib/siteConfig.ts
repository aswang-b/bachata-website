import { supabase } from './supabase';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './siteTime';
import { DEFAULT_LOCATION, type SiteLocation } from './siteLocation';

export { DEFAULT_LOCATION, placeLabel, type SiteLocation } from './siteLocation';

// The saved site time zone (site_config, migration 0051). Cached for a minute
// per server instance, since every request needs it (src/middleware.ts).

const CACHE_MS = 60 * 1000;
let cached: { tz: string; at: number } | null = null;

export async function loadSiteTimeZone(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tz;
  const { data, error } = await supabase.from('site_config').select('time_zone').eq('id', true).maybeSingle();
  if (error) {
    // A failed read isn't the saved setting: keep the last good zone (even if
    // it's older than a minute) and try again on the next request, rather than
    // switching the site to the default for a minute.
    console.error('Failed to load the site time zone:', error.message);
    return cached?.tz ?? DEFAULT_TIME_ZONE;
  }
  // Before migration 0051: what the site has always used.
  const tz = isValidTimeZone(data?.time_zone) ? data!.time_zone : DEFAULT_TIME_ZONE;
  cached = { tz, at: Date.now() };
  return tz;
}

export async function saveSiteTimeZone(tz: string): Promise<void> {
  if (!isValidTimeZone(tz)) throw new Error('Unknown time zone.');
  const { error } = await supabase.from('site_config').upsert({ id: true, time_zone: tz, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save the time zone: ${error.message}`);
  cached = { tz, at: Date.now() };
}

// ---- The WhatsApp community link (migration 0072) ----
// The site footer's WhatsApp icon and the confirmation email's (and
// printout's) footer icon open it; with none set, they're hidden. Read on its
// own query (not with the time zone, so that still loads before the
// migration), cached a minute, keeping the last good value on a failed read.

// A WhatsApp invite or chat link: https on whatsapp.com (community invites are
// chat.whatsapp.com/…) or wa.me. Anything else is null.
export function cleanWhatsappUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 300) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const whatsapp = host === 'whatsapp.com' || host.endsWith('.whatsapp.com') || host === 'wa.me';
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && whatsapp ? url.toString() : null;
  } catch {
    return null;
  }
}

let whatsappCached: { url: string | null; at: number } | null = null;

export async function loadWhatsappUrl(): Promise<string | null> {
  if (whatsappCached && Date.now() - whatsappCached.at < CACHE_MS) return whatsappCached.url;
  const { data, error } = await supabase.from('site_config').select('whatsapp_url').eq('id', true).maybeSingle();
  if (error) {
    // Before migration 0072 there's no link; otherwise keep the last good one and try again next time.
    if (!/whatsapp_url/.test(error.message)) console.error('Failed to load the WhatsApp link:', error.message);
    return whatsappCached?.url ?? null;
  }
  const url = cleanWhatsappUrl(data?.whatsapp_url);
  whatsappCached = { url, at: Date.now() };
  return url;
}

// An empty value clears it (hiding the icon and button).
export async function saveWhatsappUrl(raw: unknown): Promise<string | null> {
  const empty = typeof raw !== 'string' || raw.trim() === '';
  const url = empty ? null : cleanWhatsappUrl(raw);
  if (!empty && !url) throw new Error('That isn’t a WhatsApp link: paste the community’s invite link (https://chat.whatsapp.com/…) or a wa.me link.');
  const { error } = await supabase.from('site_config').upsert({ id: true, whatsapp_url: url, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save the WhatsApp link: ${error.message}${/whatsapp_url/.test(error.message) ? '. Run migration 0072 in Supabase first.' : ''}`);
  whatsappCached = { url, at: Date.now() };
  return url;
}

// ---- Where we are (migration 0075) ----
// The city and state the homepage, page titles and search results name, and an
// optional homepage note. Read on its own query (so the time zone and WhatsApp
// link still load before the migration), cached a minute, keeping the last
// good value on a failed read.

function cleanLocationField(raw: unknown, label: string, max: number, required: boolean): { value: string } | { error: string } {
  if (raw == null || raw === '') raw = '';
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f<>]/.test(raw.replace(/\s+/g, ' '))) return { error: `${label} can only be plain text (no < or > or control characters).` };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (required && !value) return { error: `${label} is required.` };
  if (value.length > max) return { error: `${label} can be at most ${max} characters.` };
  return { value };
}

export function cleanSiteLocation(input: unknown): { value: SiteLocation } | { error: string } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const city = cleanLocationField(body.city, 'City', 60, true);
  if ('error' in city) return city;
  const state = cleanLocationField(body.state, 'State', 30, false);
  if ('error' in state) return state;
  const note = cleanLocationField(body.note, 'The note', 80, false);
  if ('error' in note) return note;
  return { value: { city: city.value, state: state.value, note: note.value } };
}

let locationCached: { loc: SiteLocation; at: number } | null = null;

export async function loadSiteLocation(): Promise<SiteLocation> {
  if (locationCached && Date.now() - locationCached.at < CACHE_MS) return locationCached.loc;
  const { data, error } = await supabase.from('site_config').select('home_city, home_state, location_note').eq('id', true).maybeSingle();
  if (error) {
    // Before migration 0075 there are no columns; otherwise keep the last good value and try again next time.
    if (!/home_city|home_state|location_note/.test(error.message)) console.error('Failed to load the site location:', error.message);
    return locationCached?.loc ?? DEFAULT_LOCATION;
  }
  const city = typeof data?.home_city === 'string' ? data.home_city.trim() : '';
  const note = typeof data?.location_note === 'string' ? data.location_note.trim() : '';
  const loc: SiteLocation = city
    ? { city, state: typeof data?.home_state === 'string' ? data.home_state.trim() : '', note }
    : { city: DEFAULT_LOCATION.city, state: DEFAULT_LOCATION.state, note };
  locationCached = { loc, at: Date.now() };
  return loc;
}

export async function saveSiteLocation(input: unknown): Promise<SiteLocation> {
  const cleaned = cleanSiteLocation(input);
  if ('error' in cleaned) throw new Error(cleaned.error);
  const loc = cleaned.value;
  const { error } = await supabase
    .from('site_config')
    .upsert({ id: true, home_city: loc.city, home_state: loc.state, location_note: loc.note, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save the location: ${error.message}${/home_city|home_state|location_note/.test(error.message) ? '. Run migration 0075 in Supabase first.' : ''}`);
  locationCached = { loc, at: Date.now() };
  return loc;
}

import { supabase } from './supabase';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './siteTime';

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

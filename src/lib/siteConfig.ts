import { supabase } from './supabase';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './siteTime';

// The saved site time zone (site_config, migration 0051). Cached for a minute
// per server instance, since every request needs it (src/middleware.ts).

const CACHE_MS = 60 * 1000;
let cached: { tz: string; at: number } | null = null;

export async function loadSiteTimeZone(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tz;
  const { data, error } = await supabase.from('site_config').select('time_zone').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load the site time zone:', error.message);
  // Before migration 0051 (or on an error): what the site has always used.
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

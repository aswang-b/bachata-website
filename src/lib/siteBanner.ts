import { supabase } from './supabase';
import { sanitizeRichHtml } from './richText';

export interface SiteBanner {
  enabled: boolean;
  content: string;
}

// The only writer is the gated admin page, but this content renders via
// innerHTML for every site visitor, so it's still worth stripping anything
// script-capable as a safety net (e.g. a compromised admin account, or a bad paste).
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR', 'SPAN']);

export function sanitizeBannerHtml(html: string): string {
  return sanitizeRichHtml(html, ALLOWED_TAGS);
}

export async function getSiteBanner(): Promise<SiteBanner> {
  const { data, error } = await supabase.from('site_banner').select('enabled, content').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load site banner:', error.message);
  if (error || !data) return { enabled: false, content: '' };
  return { enabled: data.enabled, content: data.content };
}

export async function setSiteBanner(update: Partial<SiteBanner>): Promise<void> {
  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  if (update.enabled !== undefined) patch.enabled = update.enabled;
  if (update.content !== undefined) patch.content = sanitizeBannerHtml(update.content);

  const { error } = await supabase.from('site_banner').upsert(patch);
  if (error) throw new Error(`Failed to update site banner: ${error.message}`);
}

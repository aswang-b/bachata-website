import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { SITE_SETTING_KEYS, setSiteSetting, type SiteSettingKey } from '../../../lib/siteSettings';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { key, enabled } = body ?? {};

  if (!SITE_SETTING_KEYS.includes(key as SiteSettingKey) || typeof enabled !== 'boolean') {
    return new Response(JSON.stringify({ error: 'Invalid key or enabled value.' }), { status: 400 });
  }

  try {
    await setSiteSetting(key as SiteSettingKey, enabled);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update setting.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

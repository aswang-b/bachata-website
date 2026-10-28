import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { loadSiteTimeZone, saveSiteTimeZone } from '../../../lib/siteConfig';
import { isValidTimeZone } from '../../../lib/siteTime';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Admin → Admin → Site Time Zone (siteTime.ts): GET the saved zone, POST { timeZone } to change it.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  return json({ timeZone: await loadSiteTimeZone() });
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  if (!isValidTimeZone(body?.timeZone)) return json({ error: 'Pick a time zone from the list.' }, 400);
  try {
    await saveSiteTimeZone(body.timeZone);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to save the time zone.' }, 500);
  }
  return json({ ok: true });
};

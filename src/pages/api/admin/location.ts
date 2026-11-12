import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { cleanSiteLocation, loadSiteLocation, saveSiteLocation } from '../../../lib/siteConfig';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Admin → Admin → Where we are: GET the saved city, state and homepage note,
// POST { city, state, note } to change them.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  return json(await loadSiteLocation());
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  const cleaned = cleanSiteLocation(body);
  if ('error' in cleaned) return json({ error: cleaned.error }, 400);
  try {
    await saveSiteLocation(cleaned.value);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to save the location.' }, 500);
  }
};

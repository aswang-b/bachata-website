import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { MAX_GALLERY_FLYERS, getGalleryFlyers, isGalleryFlyerUrl, setGalleryFlyers } from '../../../lib/homepageContent';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// The homepage's past-flyers gallery (admin → Homepage). GET → the flyers in
// display order; POST { flyers } saves the whole list (uploads go through
// /api/admin/upload-event-image first).
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  return json({ flyers: await getGalleryFlyers() });
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const body = await request.json().catch(() => null);
  const flyers = body?.flyers;
  if (!Array.isArray(flyers) || !flyers.every(isGalleryFlyerUrl)) return json({ error: 'flyers must be a list of uploaded flyer images.' }, 400);
  if (flyers.length > MAX_GALLERY_FLYERS) return json({ error: `The gallery holds at most ${MAX_GALLERY_FLYERS} flyers.` }, 400);

  try {
    await setGalleryFlyers([...new Set(flyers as string[])]);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to save the gallery.' }, 500);
  }
  return json({ ok: true });
};

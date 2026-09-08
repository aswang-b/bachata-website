import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { setHomepageContent } from '../../../lib/homepageContent';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { lessonOverview } = body ?? {};

  if (lessonOverview !== undefined && typeof lessonOverview !== 'string') {
    return new Response(JSON.stringify({ error: 'lessonOverview must be a string.' }), { status: 400 });
  }

  try {
    await setHomepageContent({ lessonOverview });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update homepage content.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

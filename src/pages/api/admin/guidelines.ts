import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { getCommunityGuidelines, MAX_GUIDELINES_LENGTH, setCommunityGuidelines } from '../../../lib/communityGuidelines';

export const prerender = false;

// The community guidelines shown on the event registration form and its
// confirmations (admin → Guidelines tab).
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }
  return new Response(JSON.stringify({ body: await getCommunityGuidelines() }), { status: 200 });
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const body = payload?.body;
  if (typeof body !== 'string') {
    return new Response(JSON.stringify({ error: 'body must be a string.' }), { status: 400 });
  }
  if (body.length > MAX_GUIDELINES_LENGTH) {
    return new Response(JSON.stringify({ error: 'The guidelines are too long.' }), { status: 400 });
  }

  try {
    await setCommunityGuidelines(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save the guidelines.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

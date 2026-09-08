import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { setSiteBanner } from '../../../lib/siteBanner';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { enabled, content } = body ?? {};

  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return new Response(JSON.stringify({ error: 'enabled must be a boolean.' }), { status: 400 });
  }
  if (content !== undefined && typeof content !== 'string') {
    return new Response(JSON.stringify({ error: 'content must be a string.' }), { status: 400 });
  }

  try {
    await setSiteBanner({ enabled, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update banner.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

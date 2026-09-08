import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { ANALYTICS_LOCK_RESOURCE, getLockStatus } from '../../../lib/editLock';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const state = await getLockStatus(ANALYTICS_LOCK_RESOURCE);
  return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

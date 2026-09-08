import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { ANALYTICS_LOCK_RESOURCE, releaseLock } from '../../../lib/editLock';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const holderId = String(body?.holderId ?? '').trim();
  if (!holderId) {
    return new Response(JSON.stringify({ error: 'Missing holderId.' }), { status: 400 });
  }

  const holder = `${user.email}::${holderId}`;

  try {
    const released = await releaseLock(ANALYTICS_LOCK_RESOURCE, holder);
    return new Response(JSON.stringify({ released }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to release lock.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { SIGNUPS_LOCK_RESOURCE, CHECKINS_LOCK_RESOURCE, releaseLock } from '../../../lib/editLock';

export const prerender = false;

const RESOURCES = { signups: SIGNUPS_LOCK_RESOURCE, checkins: CHECKINS_LOCK_RESOURCE } as const;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const holderId = String(body?.holderId ?? '').trim();
  const resource = RESOURCES[body?.resource as keyof typeof RESOURCES];
  if (!holderId || !resource) {
    return new Response(JSON.stringify({ error: 'Missing holderId or invalid resource.' }), { status: 400 });
  }

  const holder = `${user.email}::${holderId}`;

  try {
    const released = await releaseLock(resource, holder);
    return new Response(JSON.stringify({ released }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to release lock.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

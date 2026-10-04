import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { LOCK_RESOURCES, getLockStatus } from '../../../lib/editLock';

export const prerender = false;

const RESOURCES = LOCK_RESOURCES;

export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const resourceKey = url.searchParams.get('resource') as keyof typeof RESOURCES | null;
  const resource = resourceKey ? RESOURCES[resourceKey] : undefined;
  if (!resource) {
    return new Response(JSON.stringify({ error: 'Invalid or missing resource.' }), { status: 400 });
  }

  const state = await getLockStatus(resource);
  return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

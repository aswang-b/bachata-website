import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user } = await requireAdmin(request);
  return new Response(JSON.stringify({ isAdmin: Boolean(user) }), { status: 200 });
};

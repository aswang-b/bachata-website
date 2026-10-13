import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error } = await requireAdmin(request);
  // sessionInvalid: the token itself was rejected (expired, or the session
  // was ended elsewhere) — as opposed to a valid session for a non-admin
  // account — so the client can refresh or ask for a new sign-in instead of
  // saying "not an admin".
  return new Response(JSON.stringify({ isAdmin: Boolean(user), sessionInvalid: !user && error !== 'Not authorized.' }), { status: 200 });
};

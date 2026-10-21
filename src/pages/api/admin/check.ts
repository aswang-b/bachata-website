import type { APIRoute } from 'astro';
import { AUTH_UNAVAILABLE, INVALID_SESSION, requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error } = await requireAdmin(request);
  // Supabase Auth couldn't be reached: say so (503) rather than call the
  // session invalid, which would sign the admin out.
  if (error === AUTH_UNAVAILABLE) return new Response(JSON.stringify({ error }), { status: 503 });
  // sessionInvalid: the token itself was rejected (expired, or the session
  // was ended elsewhere) — as opposed to a valid session for a non-admin
  // account — so the client can refresh or ask for a new sign-in instead of
  // saying "not an admin".
  return new Response(JSON.stringify({ isAdmin: Boolean(user), sessionInvalid: !user && error === INVALID_SESSION }), { status: 200 });
};

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { MAX_CHECKIN_PER_IP_CAP, setCheckinPerIpCap } from '../../../lib/notificationSettings';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { cap } = body ?? {};

  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > MAX_CHECKIN_PER_IP_CAP) {
    return new Response(JSON.stringify({ error: `Limit must be a whole number from 1 to ${MAX_CHECKIN_PER_IP_CAP}.` }), {
      status: 400,
    });
  }

  try {
    await setCheckinPerIpCap(cap);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update limit.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

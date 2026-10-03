import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { MAX_CARD_ORDER_LENGTH, setHomepageCardOrder } from '../../../lib/homepageContent';

export const prerender = false;

// A series key is a Google recurring-event id or a UUID.
const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const order = body?.order;

  // An empty list resets to the default order.
  if (!Array.isArray(order) || order.length > MAX_CARD_ORDER_LENGTH || !order.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
    return new Response(JSON.stringify({ error: 'order must be a list of class keys.' }), { status: 400 });
  }

  try {
    await setHomepageCardOrder([...new Set(order as string[])]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save the card order.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

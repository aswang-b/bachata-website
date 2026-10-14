import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import {
  HOMEPAGE_SECTIONS,
  MAX_CARD_ORDER_LENGTH,
  isHomepageSection,
  setHomepageCardOrder,
  setHomepageSectionOrder,
  type HomepageSection,
} from '../../../lib/homepageContent';

export const prerender = false;

// A series key is a Google recurring-event id or a UUID.
const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Saves the homepage card order (`order`), the section order (`sectionOrder`),
// or both. An empty list resets that one to the default order.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const order = body?.order;
  const sectionOrder = body?.sectionOrder;

  if (order === undefined && sectionOrder === undefined) {
    return new Response(JSON.stringify({ error: 'Nothing to save.' }), { status: 400 });
  }
  if (
    order !== undefined &&
    (!Array.isArray(order) || order.length > MAX_CARD_ORDER_LENGTH || !order.every((k) => typeof k === 'string' && KEY_RE.test(k)))
  ) {
    return new Response(JSON.stringify({ error: 'order must be a list of class keys.' }), { status: 400 });
  }
  if (
    sectionOrder !== undefined &&
    (!Array.isArray(sectionOrder) || sectionOrder.length > HOMEPAGE_SECTIONS.length || !sectionOrder.every(isHomepageSection))
  ) {
    return new Response(JSON.stringify({ error: `sectionOrder must be a list of: ${HOMEPAGE_SECTIONS.join(', ')}.` }), { status: 400 });
  }

  try {
    if (order !== undefined) await setHomepageCardOrder([...new Set(order as string[])]);
    if (sectionOrder !== undefined) await setHomepageSectionOrder([...new Set(sectionOrder as HomepageSection[])]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save the order.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

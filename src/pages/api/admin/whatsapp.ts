import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { loadWhatsappUrl, saveWhatsappUrl } from '../../../lib/siteConfig';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Admin → Admin → WhatsApp Community: GET the saved link, POST { url } to set
// it ('' clears it, hiding the footer icon and the confirmations' button).
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  return json({ url: await loadWhatsappUrl() });
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  try {
    return json({ url: await saveWhatsappUrl(body?.url) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to save the WhatsApp link.' }, 400);
  }
};

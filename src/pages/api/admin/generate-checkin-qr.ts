import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { requireAdmin } from '../../../lib/admin';
import { CheckinLinkError, buildCheckinLink, eventIdsFrom } from '../../../lib/checkinLink';

export const prerender = false;

// A plain QR code and link for checking in to one or more classes. The door
// sign on /admin/qr points its short link at the same address (qr-studio.ts).
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  try {
    const link = await buildCheckinLink(new URL(request.url).origin, eventIdsFrom(body), body?.createRegistration === true);
    const qrDataUrl = await QRCode.toDataURL(link.url, { width: 512, margin: 2 });
    const { url, title, scheduleLabel, createRegistration } = link;
    return new Response(JSON.stringify({ ok: true, url, qrDataUrl, title, scheduleLabel, createRegistration }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof CheckinLinkError) return new Response(JSON.stringify({ error: err.message }), { status: err.status });
    console.error('Failed to generate QR code:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate QR code.' }), { status: 500 });
  }
};

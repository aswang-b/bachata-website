import type { APIRoute } from 'astro';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { cleanSubscription, countReport, isPushEndpoint, PushError, removeSubscription, saveSubscription } from '../../lib/push';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Backstops against a bot filling the list: per network (generous, as a studio's
// Wi-Fi is shared), and for the whole site (far more than ever turn them on in a day).
const SUBSCRIBE_DAILY_CAP_PER_IP = 20;
const SUBSCRIBE_DAILY_CAP = 1000;
const MAX_BODY_BYTES = 4000;

// Turning push notifications on and off, from the header bell (components/InstallApp.astro).
// POST { action: 'subscribe', subscription, platform } saves the phone's push address;
// POST { action: 'unsubscribe', endpoint, auth } removes it (only with its own key);
// POST { action: 'shown' | 'opened', id } counts a notification shown or tapped.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Too large.' }, 413);
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Not JSON.' }, 400);
  }

  try {
    if (body?.action === 'subscribe') {
      const sub = cleanSubscription(body.subscription, body.platform);
      if (!sub) return json({ error: "That isn't a push subscription from a browser." }, 400);
      let ip = 'unknown';
      try {
        ip = clientAddress;
      } catch {
        // No address (e.g. a prerender): counted together.
      }
      if (!(await checkAndIncrementUsage(`push-subscribe:${ip}`, SUBSCRIBE_DAILY_CAP_PER_IP))) return json({ error: 'Too many devices turned notifications on from this network today. Try again tomorrow.' }, 429);
      if (!(await checkAndIncrementUsage('push-subscribe', SUBSCRIBE_DAILY_CAP))) return json({ error: 'Too many devices turned notifications on today. Try again tomorrow.' }, 429);
      await saveSubscription(sub);
      return json({ ok: true });
    }
    if (body?.action === 'unsubscribe') {
      if (!isPushEndpoint(body.endpoint) || typeof body.auth !== 'string') return json({ error: 'Missing the subscription.' }, 400);
      await removeSubscription(body.endpoint, body.auth);
      return json({ ok: true });
    }
    // The service worker (public/sw.js): a notification was shown, or tapped.
    if (body?.action === 'shown' || body?.action === 'opened') {
      if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) return json({ error: 'Missing the notification.' }, 400);
      return json({ ok: await countReport(body.id, body.action) });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    if (e instanceof PushError) return json({ error: e.message }, e.status);
    throw e;
  }
};

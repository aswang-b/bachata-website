import type { APIRoute } from 'astro';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { cleanSubscription, countReport, isPushEndpoint, PushError, removeSubscription, saveSubscription } from '../../lib/push';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A backstop against a bot filling the list: far more phones a day than ever turn notifications on.
const SUBSCRIBE_DAILY_CAP = 1000;
const MAX_BODY_BYTES = 4000;

// Turning push notifications on and off, from the header bell (components/InstallApp.astro).
// POST { action: 'subscribe', subscription, platform } saves the phone's push address;
// POST { action: 'unsubscribe', endpoint, auth } removes it (only with its own key);
// POST { action: 'shown' | 'opened', id } counts a notification shown or tapped.
export const POST: APIRoute = async ({ request }) => {
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
      if (!(await checkAndIncrementUsage('push-subscribe', SUBSCRIBE_DAILY_CAP))) return json({ error: 'Too many phones turned notifications on today. Try again tomorrow.' }, 429);
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

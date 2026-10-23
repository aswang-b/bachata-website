import { createHmac, timingSafeEqual } from 'node:crypto';

// Resend signs its webhooks the Svix way: HMAC-SHA256 of
// "<svix-id>.<svix-timestamp>.<raw body>" with the endpoint's signing secret
// ("whsec_<base64>"), sent as "v1,<base64 signature>" (several, space
// separated, while a secret is being rotated). Old messages are refused so a
// captured one can't be replayed.

const TOLERANCE_SECONDS = 5 * 60;

export function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowSeconds - sent) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// The bounced addresses in an "email.bounced" event, lowercased, with Resend's
// bounce type and message.
export function bouncesFrom(event: unknown): { email: string; bounceType: string | null; reason: string | null }[] {
  const e = (event && typeof event === 'object' ? event : {}) as { type?: unknown; data?: Record<string, unknown> };
  if (e.type !== 'email.bounced' || !e.data) return [];
  const to = Array.isArray(e.data.to) ? e.data.to : typeof e.data.to === 'string' ? [e.data.to] : [];
  const bounce = (e.data.bounce && typeof e.data.bounce === 'object' ? e.data.bounce : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 500) : null);
  return to
    .filter((t): t is string => typeof t === 'string' && t.includes('@'))
    .map((t) => ({ email: t.trim().toLowerCase(), bounceType: text(bounce.type), reason: text(bounce.message) }));
}

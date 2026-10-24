import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { env } from '../../lib/env';
import { bouncesFrom, verifyResendSignature } from '../../lib/resendWebhook';
import { logSiteError } from '../../lib/siteErrors';

export const prerender = false;

// Resend → Webhooks posts here (set up with the "email.bounced" event; its
// signing secret goes in RESEND_WEBHOOK_SECRET). Each bounced address is
// recorded in email_bounces (migration 0050) for the dashboard to flag.
export const POST: APIRoute = async ({ request }) => {
  const secret = env('RESEND_WEBHOOK_SECRET');
  if (!secret) {
    console.error('Resend webhook received, but RESEND_WEBHOOK_SECRET is not set.');
    return new Response('Not configured.', { status: 503 });
  }

  const body = await request.text();
  const signed = verifyResendSignature(
    secret,
    { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body
  );
  if (!signed) return new Response('Invalid signature.', { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON.', { status: 400 });
  }

  const bounces = bouncesFrom(event);
  if (bounces.length > 0) {
    const { error } = await supabase.from('email_bounces').upsert(
      bounces.map((b) => ({ email: b.email, bounced_at: new Date().toISOString(), bounce_type: b.bounceType, reason: b.reason })),
      { onConflict: 'email' }
    );
    if (error) {
      console.error('Failed to record email bounce:', error.message);
      // A 500 makes Resend retry later.
      return new Response('Failed to record.', { status: 500 });
    }
    // Each one is also a line in the dashboard's Errors workqueue, with actions
    // to correct the address and resend the confirmation.
    for (const b of bounces) {
      await logSiteError('email_bounce', `Email to ${b.email} bounced${b.reason ? `: ${b.reason}` : '.'}`, {
        details: { email: b.email, bounceType: b.bounceType, reason: b.reason },
        dedupeKey: `bounce:${b.email}`,
      });
    }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

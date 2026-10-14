import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { parseRecipientEmails, setConfirmationBccEmails } from '../../../lib/notificationSettings';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BCC = 10;

// Saves the admin emails BCC'd on registration confirmations. An empty string
// turns the copies off.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { bccEmails } = body ?? {};

  if (typeof bccEmails !== 'string') {
    return new Response(JSON.stringify({ error: 'bccEmails must be a string.' }), { status: 400 });
  }

  const emails = parseRecipientEmails(bccEmails);
  if (emails.length > MAX_BCC) {
    return new Response(JSON.stringify({ error: `No more than ${MAX_BCC} BCC addresses.` }), { status: 400 });
  }
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return new Response(JSON.stringify({ error: `Invalid email address: ${invalid[0]}` }), { status: 400 });
  }

  try {
    await setConfirmationBccEmails(emails.join(','));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update the BCC list.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

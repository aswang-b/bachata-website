import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { getConfirmationEmailPerIpCap, getNotificationRecipientsRaw } from '../../../lib/notificationSettings';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const [recipientEmails, confirmationEmailPerIpCap] = await Promise.all([getNotificationRecipientsRaw(), getConfirmationEmailPerIpCap()]);
  return new Response(JSON.stringify({ recipientEmails, confirmationEmailPerIpCap }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

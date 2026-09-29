import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import {
  getCheckinPerIpCap,
  getConfirmationEmailPerIpCap,
  getContactEmailPerIpCap,
  getNotificationRecipientsRaw,
} from '../../../lib/notificationSettings';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const [recipientEmails, confirmationEmailPerIpCap, contactEmailPerIpCap, checkinPerIpCap] = await Promise.all([
    getNotificationRecipientsRaw(),
    getConfirmationEmailPerIpCap(),
    getContactEmailPerIpCap(),
    getCheckinPerIpCap(),
  ]);
  return new Response(JSON.stringify({ recipientEmails, confirmationEmailPerIpCap, contactEmailPerIpCap, checkinPerIpCap }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

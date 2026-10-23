import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { sendEmail } from '../../../lib/email';
import { checkAndIncrementUsage } from '../../../lib/apiUsage';
import { buildRegistrationConfirmation, CONFIRMATION_EMAIL_DAILY_CAP } from '../../../lib/registrationConfirmation';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// POST { submissionId } → resends a class/event sign-up's confirmation email
// to each of its dancers' current addresses (e.g. after fixing one that
// bounced). Counts toward the daily confirmation email cap; no admin BCC copy.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const body = await request.json().catch(() => null);
  const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : '';
  if (!submissionId) return json({ error: 'Missing submissionId.' }, 400);

  let confirmation;
  try {
    confirmation = await buildRegistrationConfirmation(submissionId);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to build the email.' }, 500);
  }
  if (!confirmation) return json({ error: 'Sign-up not found.' }, 404);
  if (confirmation.recipients.length === 0) return json({ error: 'No one on this sign-up has an email address.' }, 400);

  const sent: string[] = [];
  const failed: string[] = [];
  for (const recipient of confirmation.recipients) {
    if (!(await checkAndIncrementUsage('resend_confirmation_email', CONFIRMATION_EMAIL_DAILY_CAP))) {
      failed.push(recipient);
      continue;
    }
    try {
      await sendEmail(recipient, confirmation.subject, confirmation.html);
      sent.push(recipient);
    } catch (err) {
      console.error('Failed to resend a registration confirmation:', err);
      failed.push(recipient);
    }
  }

  if (sent.length === 0) return json({ error: "Couldn't send the email (or today's email limit is reached). Try again later.", failed }, 502);
  return json({ ok: true, sent, failed });
};

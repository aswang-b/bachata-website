import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { sendEmail } from '../../../lib/email';
import { checkAndIncrementUsage } from '../../../lib/apiUsage';
import { getConfirmationBccEmails } from '../../../lib/notificationSettings';
import { buildRegistrationConfirmation, CONFIRMATION_EMAIL_DAILY_CAP } from '../../../lib/registrationConfirmation';
import { closeSiteError, getOpenSiteError, listOpenSiteErrors } from '../../../lib/siteErrors';
import { isDeletedDancer } from '../../../lib/recyclingBin';
import { signupsWithEmail } from '../../../lib/bouncedSignups';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;

// A dancer's (or a single-person sign-up's) current email.
async function currentEmail(submissionId: string, dancerIndex: number | null): Promise<string | null> {
  const { data } = await supabase.from('intake_submissions').select('email, dancers').eq('id', submissionId).is('deleted_at', null).maybeSingle();
  if (!data) return null;
  if (dancerIndex != null && Array.isArray(data.dancers)) return (data.dancers as Record<string, string>[])[dancerIndex]?.email || null;
  return data.email || null;
}

// Writes a dancer's (or a single-person sign-up's) corrected email. The
// dancers list is only written back if nobody changed it since it was read
// (e.g. another admin moving a dancer to the Recycling Bin), retrying on a
// fresh copy otherwise, so a concurrent edit is never overwritten.
async function saveDancerEmail(submissionId: string, dancerIndex: number | null, email: string): Promise<'ok' | 'not-found' | 'failed'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await supabase.from('intake_submissions').select('dancers').eq('id', submissionId).is('deleted_at', null).maybeSingle();
    if (!row) return 'not-found';
    const dancers = Array.isArray(row.dancers) ? [...(row.dancers as Record<string, unknown>[])] : null;
    const update: Record<string, unknown> = {};
    if (dancers && dancerIndex != null) {
      // A dancer in the Recycling Bin can only come back through a restore.
      if (!dancers[dancerIndex] || isDeletedDancer(dancers[dancerIndex])) return 'not-found';
      dancers[dancerIndex] = { ...dancers[dancerIndex], email };
      update.dancers = dancers;
    }
    // The sign-up's own email mirrors its first dancer.
    if (dancerIndex == null || dancerIndex === 0) update.email = email;
    let query = supabase.from('intake_submissions').update(update).eq('id', submissionId).is('deleted_at', null);
    if (update.dancers) query = query.eq('dancers', JSON.stringify(row.dancers));
    const { data: written, error } = await query.select('id');
    if (error) return 'failed';
    if (written && written.length > 0) return 'ok';
  }
  return 'failed';
}

// Admin → Dashboard → Errors: the open errors (a bounce lists the sign-ups
// using that address), and their actions.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    const errors = await listOpenSiteErrors();
    const withMatches = await Promise.all(
      errors.map(async (e) => (e.kind === 'email_bounce' && typeof e.details.email === 'string' ? { ...e, signups: await signupsWithEmail(e.details.email) } : e))
    );
    return json({ errors: withMatches });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to load errors.' }, 500);
  }
};

// { action: 'dismiss', id }
// { action: 'update-email', id, submissionId, dancerIndex, email }: corrects the address on the registration.
// { action: 'resend', id, submissionId, dancerIndex }: sends the confirmation to that dancer's (corrected)
//   address, BCC'ing the admins on the Registration Confirmation BCC list, and resolves the error.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return json({ error: 'Missing error id.' }, 400);
  const by = user.email ?? 'admin';

  try {
    const siteError = await getOpenSiteError(id);
    if (!siteError) return json({ error: 'That error is already closed.' }, 404);

    if (body.action === 'dismiss') {
      await closeSiteError(id, 'dismissed', by);
      return json({ ok: true });
    }

    const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
    const dancerIndex = Number.isInteger(body.dancerIndex) ? (body.dancerIndex as number) : null;
    if (siteError.kind !== 'email_bounce' || !submissionId) return json({ error: 'Unknown action.' }, 400);

    if (body.action === 'update-email') {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!EMAIL_RE.test(email) || email.length > 200) return json({ error: "That email address isn't in a valid format." }, 400);
      const saved = await saveDancerEmail(submissionId, dancerIndex, email);
      if (saved !== 'ok') return json({ error: saved === 'not-found' ? 'Sign-up not found.' : 'Failed to update the sign-up.' }, saved === 'not-found' ? 404 : 500);
      let regs = supabase.from('class_registrations').update({ email }).eq('submission_id', submissionId).is('deleted_at', null);
      regs = dancerIndex == null ? regs.is('dancer_index', null) : regs.eq('dancer_index', dancerIndex);
      const { error: regError } = await regs;
      if (regError) return json({ error: 'Failed to update the class registrations.' }, 500);
      return json({ ok: true, email });
    }

    if (body.action === 'resend') {
      const to = await currentEmail(submissionId, dancerIndex);
      if (!to) return json({ error: 'This dancer has no email address.' }, 400);
      const confirmation = await buildRegistrationConfirmation(submissionId);
      if (!confirmation) return json({ error: 'Sign-up not found.' }, 404);
      if (!(await checkAndIncrementUsage('resend_confirmation_email', CONFIRMATION_EMAIL_DAILY_CAP))) {
        return json({ error: "Today's confirmation email limit is reached. Try again tomorrow." }, 429);
      }
      const bcc = (await getConfirmationBccEmails()).filter((e) => e.toLowerCase() !== to.toLowerCase());
      await sendEmail(to, confirmation.subject, confirmation.html, { bcc });
      await closeSiteError(id, 'resolved', by);
      return json({ ok: true, sent: to, bcc });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed.' }, 500);
  }
};

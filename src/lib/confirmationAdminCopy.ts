import { supabase } from './supabase';
import { sendEmail } from './email';
import { getConfirmationBccEmails } from './notificationSettings';
import { buildRegistrationConfirmation } from './registrationConfirmation';
import { escapeHtml } from './registrationEmail';
import { logSiteError } from './siteErrors';

// The admins' copy of a registration confirmation (Settings → Registration
// Confirmation BCC), one per sign-up. It waits for Resend to report how the
// dancers' emails went (api/resend-webhook.ts) so it can say which bounced,
// right in the copy instead of in an email of its own; a copy Resend never
// reports on goes out from the 15-minute scheduled job. Pending copies live in
// confirmation_admin_copies (migrations 0058-0059).

export const STALE_COPY_MINUTES = 20;

export interface EmailOutcome {
  status: 'delivered' | 'bounced' | 'failed';
  email: string;
  reason?: string | null;
}

// A dancer email from the sign-up: Resend's id when it went out, null when the send failed.
export interface SentConfirmation {
  email: string;
  id: string | null;
  error?: string;
}

// The note on top of the admins' copy for each dancer email that didn't arrive.
export function undeliveredNoteHtml(outcomes: EmailOutcome[]): string {
  const missed = outcomes.filter((o) => o.status !== 'delivered');
  if (missed.length === 0) return '';
  const items = missed
    .map((o) => `<li style="margin:0 0 4px;"><strong>${escapeHtml(o.email)}</strong> — ${o.status === 'bounced' ? 'bounced' : "couldn't be sent"}${o.reason ? `: ${escapeHtml(o.reason)}` : ''}</li>`)
    .join('');
  return `
    <div style="max-width:560px;margin:0 auto 20px;padding:12px 16px;border:2px solid #d72244;border-radius:8px;background:#fdecef;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <p style="margin:0 0 6px;font-weight:bold;">This confirmation didn't reach the dancer:</p>
      <ul style="margin:0 0 6px;padding-left:20px;font-size:13px;">${items}</ul>
      <p style="margin:0;font-size:13px;">Check Admin → Dashboard → Errors to fix the address and resend it.</p>
    </div>`;
}

// Sends the copy now, to the first admin with the rest BCC'd (so they don't see
// each other's addresses), noting any dancer email that didn't arrive. False
// when it couldn't be sent (logged to the Errors workqueue) so it can be retried.
async function sendAdminCopy(submissionId: string, outcomes: EmailOutcome[]): Promise<boolean> {
  try {
    const admins = await getConfirmationBccEmails();
    if (admins.length === 0) return true;
    const confirmation = await buildRegistrationConfirmation(submissionId);
    // Gone (e.g. moved to the Recycling Bin) since it was sent.
    if (!confirmation) return true;
    const note = undeliveredNoteHtml(outcomes);
    const subject = note ? `Not delivered: ${confirmation.subject}` : confirmation.subject;
    await sendEmail(admins[0], subject, note + confirmation.html, { bcc: admins.slice(1) });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to send the admins' copy of a registration confirmation:", message);
    await logSiteError('email_send', `Couldn't send the admins' copy of a registration confirmation (it's retried up to 3 times): ${message}`, {
      details: { submissionId },
      dedupeKey: 'admin-copy-send',
    });
    return false;
  }
}

interface CopyRow {
  id: string;
  submission_id: string;
  email_ids: string[];
  outcomes: unknown;
}

const outcomesOf = (row: { outcomes: unknown }) => Object.values((row.outcomes ?? {}) as Record<string, EmailOutcome>);

// Sends claimed copies; one that fails goes back in the queue for the
// scheduled job (claim_stale_confirmation_copies, at most 3 tries).
async function sendClaimed(rows: CopyRow[]): Promise<void> {
  for (const row of rows) {
    if (await sendAdminCopy(row.submission_id, outcomesOf(row))) continue;
    const { error } = await supabase.from('confirmation_admin_copies').update({ sent_at: null }).eq('id', row.id);
    if (error) console.error("Failed to put the admins' confirmation copy back in the queue:", error.message);
  }
}

// After a sign-up's confirmations go out: sends the admins' copy right away
// when there's nothing to wait for (no dancer email went out), otherwise
// queues it to send once Resend reports on each one (reports that came in
// first are merged in). Never throws.
export async function queueAdminCopy(submissionId: string, sent: SentConfirmation[]): Promise<void> {
  try {
    const failed: EmailOutcome[] = sent.filter((s) => !s.id).map((s) => ({ status: 'failed', email: s.email, reason: s.error ?? null }));
    const ids = sent.flatMap((s) => (s.id ? [s.id] : []));
    const outcomes = Object.fromEntries(failed.map((f, i) => [`failed:${i}`, f]));
    if (ids.length === 0) {
      if (await sendAdminCopy(submissionId, failed)) return;
      // Nothing to wait for: the scheduled job retries it.
      const { error } = await supabase.from('confirmation_admin_copies').insert({ submission_id: submissionId, email_ids: [], outcomes });
      if (error) console.error("Failed to queue the admins' confirmation copy for a retry:", error.message);
      return;
    }
    const { data, error } = await supabase.rpc('queue_confirmation_copy', { p_submission_id: submissionId, p_email_ids: ids, p_outcomes: outcomes });
    if (error) {
      // Better a copy without the delivery news than none.
      console.error("Failed to save the admins' confirmation copy; sending it now:", error.message);
      await sendAdminCopy(submissionId, failed);
      return;
    }
    await sendClaimed((data ?? []) as CopyRow[]);
  } catch (err) {
    console.error("Failed to send the admins' copy of a registration confirmation:", err);
  }
}

// A Resend delivered/bounced event for one email (kept even if its copy isn't
// queued yet). Once every email of a sign-up has reported, the admins' copy
// goes out (claimed in the database, so only once even if events arrive
// together or twice).
export async function recordDeliveryOutcome(emailId: string, outcome: EmailOutcome): Promise<void> {
  const { data, error } = await supabase.rpc('record_confirmation_outcome', { p_email_id: emailId, p_outcome: outcome });
  if (error) throw new Error(`Failed to record an email's delivery: ${error.message}`);
  await sendClaimed((data ?? []) as CopyRow[]);
}

// Run by the 15-minute scheduled job: copies Resend never fully reported on,
// or whose send failed, go out with what's known. Copies made by the test
// suite (its email sink's ids) are claimed but never sent.
export async function sendStaleAdminCopies(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_stale_confirmation_copies', { p_minutes: STALE_COPY_MINUTES });
  if (error) {
    await logSiteError('email_send', `Couldn't check for admin confirmation copies waiting to go out: ${error.message}`, { dedupeKey: 'admin-copies' });
    return 0;
  }
  const rows = ((data ?? []) as CopyRow[]).filter((r) => !r.email_ids.some((id) => id.startsWith('sink_')));
  await sendClaimed(rows);
  return rows.length;
}

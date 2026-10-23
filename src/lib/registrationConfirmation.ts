import { supabase } from './supabase';
import { env } from './env';
import { getClassRegistrationsForSubmission } from './classRegistrations';
import { listFaqs } from './faqs';
import { buildRegistrationConfirmationEmailHtml } from './registrationEmail';
import { buildReceiptLines, paymentAgreementText, receiptSubtotal } from './registrationReceipt';
import { getCommunityGuidelines, guidelineSections } from './communityGuidelines';

// The confirmation email for a class or event sign-up, built from what's
// saved for it (so a resend from the dashboard matches what was first sent,
// with any corrected email address). Sent by submit-intake.ts right after a
// sign-up and by /api/admin/resend-confirmation.

const REGISTRATION_TYPE_LABELS: Record<string, string> = {
  group: 'Group Lesson',
  events: 'Event / Workshop',
};

// Dancer confirmation emails get their own daily counter, so a bot posting
// registrations can't use up the cap the admin (Contact Me) notifications rely on.
export const CONFIRMATION_EMAIL_DAILY_CAP = Number(env('RESEND_CONFIRMATION_DAILY_CAP')) || 100;

interface SavedDancer {
  firstName?: string;
  lastName?: string;
  role?: string;
  phone?: string;
  email?: string;
  deleted?: boolean;
}

export interface RegistrationConfirmation {
  subject: string;
  html: string;
  // Each live dancer's email, once each.
  recipients: string[];
  isEvent: boolean;
}

// null when the sign-up doesn't exist, is in the Recycling Bin, or isn't a
// class or event registration. `guidelines` saves a lookup when the caller
// already has them.
export async function buildRegistrationConfirmation(submissionId: string, opts: { guidelines?: string } = {}): Promise<RegistrationConfirmation | null> {
  const { data: row, error } = await supabase
    .from('intake_submissions')
    .select('registration_type, created_at, first_name, last_name, email, phone, instagram, whatsapp, class, comments, dancers, payment_method')
    .eq('id', submissionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the sign-up: ${error.message}`);
  if (!row || !(row.registration_type in REGISTRATION_TYPE_LABELS)) return null;

  const isEvent = row.registration_type === 'events';
  // Dancers moved to the Recycling Bin aren't on the sign-up anymore.
  const dancers = Array.isArray(row.dancers) ? (row.dancers as SavedDancer[]).filter((d) => d && !d.deleted) : null;

  const rows: [string, string][] = [];
  if (dancers && dancers.length > 0) {
    for (const d of dancers) rows.push([`${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(), [d.role, d.phone, d.email].filter(Boolean).join(' · ')]);
  } else {
    rows.push(['Name', `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()]);
    if (row.email) rows.push(['Email', row.email]);
    if (row.phone) rows.push(['Phone', row.phone]);
    if (row.instagram) rows.push(['Instagram', row.instagram]);
    if (row.whatsapp) rows.push(['WhatsApp', row.whatsapp]);
  }

  // Itemized classes + subtotal, same as /register/confirmation shows.
  const receiptLines = await buildReceiptLines(await getClassRegistrationsForSubmission(submissionId));
  const subtotal = receiptSubtotal(receiptLines);
  if (receiptLines.length === 0) {
    // No saved registration rows to itemize: fall back to the class text,
    // one class per paragraph (it's joined with "; " for storage).
    const classes = String(row.class ?? '')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .join('\n\n');
    if (classes) rows.push([isEvent ? 'Event' : 'Class', classes]);
  }
  if (row.comments) rows.push(['Notes', row.comments]);

  // Events list their community guidelines where classes list the FAQ reminders.
  const reminders = isEvent
    ? guidelineSections(opts.guidelines ?? (await getCommunityGuidelines())).map((s) => ({ question: s.title ?? '', answer: s.body }))
    : (await listFaqs()).filter((f) => f.includeInConfirmation).map((f) => ({ question: f.question, answer: f.answer }));

  const html = buildRegistrationConfirmationEmailHtml({
    registrationTypeLabel: REGISTRATION_TYPE_LABELS[row.registration_type],
    createdAt: new Date(row.created_at),
    summaryRows: rows,
    receiptLines,
    subtotal,
    isEvent,
    paymentNote: paymentAgreementText(row.payment_method),
    faqs: reminders,
    faqsHeading: isEvent ? 'Our Community Guidelines' : undefined,
  });

  const addresses = (dancers && dancers.length > 0 ? dancers.map((d) => d.email) : [row.email]).map((e) => (e ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const recipients = addresses.filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));

  return { subject: `Your ${isEvent ? 'Event' : 'Class'} Registration is Confirmed — Dance with B`, html, recipients, isEvent };
}

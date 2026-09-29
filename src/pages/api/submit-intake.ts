import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { sendAdminNotification, sendEmail } from '../../lib/email';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { env } from '../../lib/env';
import {
  getClassRegistrationsForSubmission,
  insertClassRegistrations,
  resolveClassSelections,
  validateClassSelections,
} from '../../lib/classRegistrations';
import { listFaqs } from '../../lib/faqs';
import { buildRegistrationConfirmationEmailHtml } from '../../lib/registrationEmail';

export const prerender = false;

const REGISTRATION_TYPE_LABELS: Record<string, string> = {
  group: 'Group Lesson',
  private: 'Private Instruction',
  events: 'Event / Workshop',
};

// Hard daily cap on admin notification emails, as a backstop against a spam
// bot hammering the public intake form and running up Resend cost — the form
// submission itself is never blocked by this, only the notification email.
const EMAIL_DAILY_CAP = Number(env('RESEND_DAILY_CAP')) || 200;

// Server-side backstop matching the client's own limits (register.astro's
// MAX_DANCERS), since a direct POST can otherwise bypass client-side caps
// entirely and insert an unbounded row into intake_submissions.
const MAX_DANCERS = 5;
const MAX_NAME_LENGTH = 100;
const MAX_CONTACT_LENGTH = 200;
const MAX_COMMENTS_LENGTH = 2000;
const MAX_CLASS_LENGTH = 200;

interface Dancer {
  firstName: string;
  lastName: string;
  role: 'leader' | 'follower' | '';
  phone: string;
  email: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();

  const registrationType = String(formData.get('registration_type') ?? '').trim();
  const className = String(formData.get('class') ?? '').trim();
  const classSelectionsRaw = String(formData.get('class_selections') ?? '').trim();
  const comments = String(formData.get('comments') ?? '').trim();
  const paymentMethod = String(formData.get('payment_method') ?? '').trim();

  let firstName = '';
  let lastName = '';
  let email = '';
  let phone = '';
  let instagram = '';
  let whatsapp = '';
  let dancers: Dancer[] | null = null;

  if (registrationType === 'group') {
    const dancersRaw = String(formData.get('dancers') ?? '');
    try {
      dancers = JSON.parse(dancersRaw);
    } catch {
      dancers = null;
    }

    if (
      !className ||
      className.length > MAX_CLASS_LENGTH ||
      !paymentMethod ||
      !dancers ||
      dancers.length === 0 ||
      dancers.length > MAX_DANCERS ||
      !dancers.every(
        (d) =>
          d.firstName &&
          d.firstName.length <= MAX_NAME_LENGTH &&
          d.lastName &&
          d.lastName.length <= MAX_NAME_LENGTH &&
          d.role &&
          (d.phone || d.email) &&
          (!d.phone || d.phone.length <= MAX_CONTACT_LENGTH) &&
          (!d.email || d.email.length <= MAX_CONTACT_LENGTH)
      )
    ) {
      return new Response(
        `Missing or invalid fields: a class, a payment method, and each dancer's first name, last name, role, and a phone or email (max ${MAX_DANCERS} dancers).`,
        { status: 400 }
      );
    }

    firstName = dancers[0].firstName;
    lastName = dancers[0].lastName;
    email = dancers.map((d) => d.email).find(Boolean) ?? '';
    phone = dancers.map((d) => d.phone).find(Boolean) ?? '';
  } else {
    firstName = String(formData.get('first_name') ?? '').trim();
    lastName = String(formData.get('last_name') ?? '').trim();
    email = String(formData.get('email') ?? '').trim();
    phone = String(formData.get('phone') ?? '').trim();
    instagram = String(formData.get('instagram') ?? '').trim();
    whatsapp = String(formData.get('whatsapp') ?? '').trim();

    // The contact-method picker (registrationType === 'private') requires at
    // least one of these; other registration types only require an email.
    const hasAnyContactMethod = email || phone || instagram || whatsapp;

    if (
      !firstName ||
      firstName.length > MAX_NAME_LENGTH ||
      !lastName ||
      lastName.length > MAX_NAME_LENGTH ||
      !hasAnyContactMethod ||
      email.length > MAX_CONTACT_LENGTH ||
      phone.length > MAX_CONTACT_LENGTH ||
      instagram.length > MAX_CONTACT_LENGTH ||
      whatsapp.length > MAX_CONTACT_LENGTH
    ) {
      return new Response('Missing or invalid fields: First Name, Last Name, and a way to contact you are required.', {
        status: 400,
      });
    }
  }

  if (className.length > MAX_CLASS_LENGTH || comments.length > MAX_COMMENTS_LENGTH) {
    return new Response('One of the fields is too long.', { status: 400 });
  }

  const selections = resolveClassSelections(className || null, classSelectionsRaw || null);
  const closedError = await validateClassSelections(selections);
  if (closedError) {
    return new Response(closedError, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('intake_submissions')
    .insert({
      registration_type: registrationType || 'unspecified',
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      instagram: instagram || null,
      whatsapp: whatsapp || null,
      class: className || null,
      comments: comments || null,
      dancers: dancers ?? null,
      payment_method: paymentMethod || null,
    })
    .select('id')
    .single();

  if (error || !row) {
    console.error('Failed to insert intake submission:', error);
    return new Response('Something went wrong submitting your form. Please try again.', {
      status: 500,
    });
  }

  await insertClassRegistrations({
    submissionId: row.id,
    classRaw: className || null,
    classSelectionsRaw: classSelectionsRaw || null,
    dancers,
    fallbackFirstName: firstName,
    fallbackLastName: lastName,
    fallbackEmail: email || null,
    fallbackPhone: phone || null,
  });

  const confirmationBase = registrationType === 'private' ? '/contact/confirmation' : '/register/confirmation';
  const confirmationUrl = `${confirmationBase}?id=${row.id}`;

  // Admin notification emails are only sent for the Contact Me form — group
  // and events registrations show up in /admin/analytics and /admin/inbox
  // without paging the admin's inbox for every sign-up. Those two class-
  // registration flows instead email each dancer who provided an email a
  // confirmation of their own, matching what /register/confirmation shows.
  if (registrationType !== 'private') {
    try {
      const emailRecipients = Array.from(
        new Set((dancers && dancers.length > 0 ? dancers.map((d) => d.email) : [email]).filter((e): e is string => Boolean(e)))
      );

      if (emailRecipients.length > 0) {
        const rows: [string, string][] = [];
        if (dancers) {
          dancers.forEach((d) => {
            const contactParts = [d.role, d.phone, d.email].filter(Boolean);
            rows.push([`${d.firstName} ${d.lastName}`, contactParts.join(' · ')]);
          });
        } else {
          rows.push(['Name', `${firstName} ${lastName}`]);
          if (email) rows.push(['Email', email]);
          if (phone) rows.push(['Phone', phone]);
          if (instagram) rows.push(['Instagram', instagram]);
          if (whatsapp) rows.push(['WhatsApp', whatsapp]);
        }
        // The classes are joined with "; " for storage/display elsewhere,
        // but read better in the email as separate paragraphs.
        const classesForEmail = className
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean)
          .join('\n\n');
        if (classesForEmail) rows.push(['Class', classesForEmail]);
        if (paymentMethod) rows.push(['Payment', paymentMethod === 'venmo' ? 'Venmo' : 'Cash at the door']);
        if (comments) rows.push(['Notes', comments]);

        const classRegistrations = await getClassRegistrationsForSubmission(row.id);
        const subtotal = classRegistrations.some((r) => r.price != null)
          ? classRegistrations.reduce((sum, r) => sum + (r.price ?? 0), 0)
          : null;

        const faqs = await listFaqs();
        const html = buildRegistrationConfirmationEmailHtml({
          registrationTypeLabel: REGISTRATION_TYPE_LABELS[registrationType] ?? registrationType,
          createdAt: new Date(),
          summaryRows: rows,
          subtotal,
          faqs: faqs.filter((f) => f.includeInConfirmation).map((f) => ({ question: f.question, answer: f.answer })),
        });

        for (const recipient of emailRecipients) {
          const allowed = await checkAndIncrementUsage('resend_email', EMAIL_DAILY_CAP);
          if (!allowed) {
            console.warn('Daily Resend email cap reached — skipping remaining registration confirmation emails.');
            break;
          }
          try {
            await sendEmail(recipient, 'Your Class Registration is Confirmed — Dance with B', html);
          } catch (err) {
            console.error('Failed to send registration confirmation to a recipient:', err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to send registration confirmation email:', err);
      // The submission itself already succeeded and is safely in the database.
    }

    return redirect(confirmationUrl, 303);
  }

  try {
    const allowed = await checkAndIncrementUsage('resend_email', EMAIL_DAILY_CAP);
    if (!allowed) {
      console.warn('Daily Resend email cap reached — skipping admin notification for this submission.');
      return redirect(confirmationUrl, 303);
    }

    const rows: [string, string][] = [];

    if (dancers) {
      dancers.forEach((d, i) => {
        const parts = [`${d.firstName} ${d.lastName}`, d.role];
        if (d.phone) parts.push(d.phone);
        if (d.email) parts.push(d.email);
        rows.push([`Dancer ${i + 1}`, parts.join(' · ')]);
      });
    } else {
      rows.push(['Name', `${firstName} ${lastName}`]);
      if (email) rows.push(['Email', email]);
      if (phone) rows.push(['Phone', phone]);
      if (instagram) rows.push(['Instagram', instagram]);
      if (whatsapp) rows.push(['WhatsApp', whatsapp]);
    }
    if (className) rows.push(['Class', className]);
    if (paymentMethod) rows.push(['Payment method', paymentMethod === 'venmo' ? 'Venmo' : 'Cash at the door']);
    if (comments) rows.push(['Notes', comments]);

    const html = `
      <h2>New Contact Request</h2>
      <table cellpadding="6" cellspacing="0">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="font-weight:bold;vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value).replace(/\n/g, '<br/>')}</td></tr>`
          )
          .join('')}
      </table>
    `;

    await sendAdminNotification(`Website Contact Request - ${firstName} ${lastName}`, html);
  } catch (err) {
    console.error('Failed to send admin notification email:', err);
    // The submission itself already succeeded and is safely in the database.
  }

  return redirect(confirmationUrl, 303);
};

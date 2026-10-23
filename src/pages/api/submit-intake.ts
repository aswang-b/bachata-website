import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { sendAdminNotification, sendEmail } from '../../lib/email';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { env } from '../../lib/env';
import {
  prepareRegistrationRows,
  resolveClassSelections,
  validateClassSelections,
  type RegistrationRow,
} from '../../lib/classRegistrations';
import { getConfirmationBccEmails, getConfirmationEmailPerIpCap, getContactEmailPerIpCap } from '../../lib/notificationSettings';
import { flagDuplicateSubmission } from '../../lib/duplicateSubmissions';
import { buildRegistrationConfirmation, CONFIRMATION_EMAIL_DAILY_CAP } from '../../lib/registrationConfirmation';
import { saveContactMessage } from '../../lib/contactMessages';
import { capacityErrorMessage } from '../../lib/capacity';
import { getCommunityGuidelines, hasGuidelines } from '../../lib/communityGuidelines';

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
const MAX_CLASS_SELECTIONS_LENGTH = 10000;
const MAX_DANCERS_LENGTH = 10000;
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;


interface Dancer {
  firstName: string;
  lastName: string;
  role: 'leader' | 'follower' | '';
  phone: string;
  email: string;
}

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Rebuilt from the known fields only, so nothing else the browser sends (such
// as the "deleted" flag the Recycling Bin reads) is ever saved with a dancer.
function toDancer(d: Record<string, unknown>, isEvent: boolean): Dancer {
  return {
    firstName: field(d.firstName),
    lastName: field(d.lastName),
    role: isEvent ? '' : (field(d.role).toLowerCase() as Dancer['role']),
    phone: field(d.phone),
    email: field(d.email),
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const POST: APIRoute = async ({ request, redirect, clientAddress }) => {
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

  if (!Object.hasOwn(REGISTRATION_TYPE_LABELS, registrationType)) {
    return new Response('Unknown registration type.', { status: 400 });
  }

  // Classes (group) and events share the multi-attendee form; only classes
  // ask for a Leader/Follower role, and an event only needs a payment method
  // when it has a price (the form only asks then). Only these two sign people
  // up for classes; the Contact form (private) just sends a message.
  const isEvent = registrationType === 'events';
  const isRegistration = registrationType === 'group' || isEvent;
  if (isRegistration) {
    const dancersRaw = String(formData.get('dancers') ?? '');
    if (dancersRaw.length > MAX_DANCERS_LENGTH) {
      return new Response('One of the fields is too long.', { status: 400 });
    }
    try {
      const parsed: unknown = JSON.parse(dancersRaw);
      // Spots are counted per role in lowercase, so the role is normalized
      // here and anything but "leader" or "follower" is refused below.
      dancers = Array.isArray(parsed) ? parsed.map((d) => (d && typeof d === 'object' ? toDancer(d, isEvent) : d)) : null;
    } catch {
      dancers = null;
    }

    const badEmailIndex = Array.isArray(dancers) ? dancers.findIndex((d) => d?.email && !EMAIL_RE.test(d.email)) : -1;
    if (badEmailIndex >= 0) {
      const who = dancers!.length > 1 ? `Dancer ${badEmailIndex + 1}'s email address` : 'The email address';
      return new Response(`${who} isn't in a valid format — it should look like name@example.com.`, { status: 400 });
    }

    if (
      !className ||
      className.length > MAX_CLASS_LENGTH ||
      (!paymentMethod && !isEvent) ||
      !dancers ||
      dancers.length === 0 ||
      dancers.length > MAX_DANCERS ||
      !dancers.every(
        (d) =>
          d &&
          typeof d === 'object' &&
          d.firstName &&
          d.firstName.length <= MAX_NAME_LENGTH &&
          d.lastName &&
          d.lastName.length <= MAX_NAME_LENGTH &&
          (isEvent || d.role === 'leader' || d.role === 'follower') &&
          (d.phone || d.email) &&
          (!d.phone || d.phone.length <= MAX_CONTACT_LENGTH) &&
          (!d.email || d.email.length <= MAX_CONTACT_LENGTH)
      )
    ) {
      return new Response(
        isEvent
          ? `Missing or invalid fields: an event, and each attendee's first name, last name, and a phone or email (max ${MAX_DANCERS} attendees).`
          : `Missing or invalid fields: a class, a payment method, and each dancer's first name, last name, role, and a phone or email (max ${MAX_DANCERS} dancers).`,
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

    if (email && !EMAIL_RE.test(email)) {
      return new Response("That email address isn't in a valid format — it should look like name@example.com.", { status: 400 });
    }

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

  if (className.length > MAX_CLASS_LENGTH || comments.length > MAX_COMMENTS_LENGTH || classSelectionsRaw.length > MAX_CLASS_SELECTIONS_LENGTH) {
    return new Response('One of the fields is too long.', { status: 400 });
  }

  // Loaded while the classes are checked (it never fails: blank on error).
  const guidelinesLoad = isEvent ? getCommunityGuidelines() : Promise.resolve('');

  let registrationRows: RegistrationRow[] = [];
  if (isRegistration) {
    const selections = resolveClassSelections(className || null, classSelectionsRaw || null);
    const selectionError = await validateClassSelections(selections);
    if (selectionError) {
      return new Response(selectionError.message, { status: selectionError.status });
    }
    // Only classes on the class form and only events on the events form, so
    // an event can't be booked here without agreeing to the guidelines.
    const prepared = await prepareRegistrationRows(selections, isEvent ? 'event' : 'class', dancers!);
    if ('error' in prepared) {
      return new Response(prepared.error.message, { status: prepared.error.status });
    }
    // Events skip the payment step only when they're free.
    if (isEvent && !paymentMethod && prepared.hasCost) {
      return new Response('Please choose a payment method.', { status: 400 });
    }
    registrationRows = prepared.rows;
  }

  // Event registrants agree to the community guidelines (when there are any).
  const guidelines = await guidelinesLoad;
  const agreedToGuidelines = formData.get('agree_guidelines') === 'on';
  if (hasGuidelines(guidelines) && !agreedToGuidelines) {
    return new Response("Please confirm you've read the community guidelines.", { status: 400 });
  }

  const confirmationBase = registrationType === 'private' ? '/contact/confirmation' : '/register/confirmation';
  let submissionId: string;
  if (registrationType === 'private') {
    // A Contact form message isn't a sign-up: it has its own table
    // (migration 0049). The same message sent twice is saved once, sends no
    // second email, and shows the original's confirmation.
    const saved = await saveContactMessage({
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      instagram: instagram || null,
      whatsapp: whatsapp || null,
      message: comments || null,
    });
    if (!saved) {
      return new Response('Something went wrong submitting your form. Please try again.', { status: 500 });
    }
    if (saved.duplicateOf) return redirect(`${confirmationBase}?id=${saved.duplicateOf}`, 303);
    submissionId = saved.id;
  } else {
    // The sign-up and its class registrations are saved together, with
    // capacity enforced on them in the same transaction (migration 0046).
    const { data, error } = await supabase.rpc('register_submission', {
      p_submission: {
        registration_type: registrationType,
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
        guidelines_agreed_at: isEvent && agreedToGuidelines ? new Date().toISOString() : null,
      },
      p_rows: registrationRows,
    });

    if (error?.message === 'capacity_exceeded') {
      return new Response(capacityErrorMessage(error.details), { status: 400 });
    }
    if (error || typeof data !== 'string') {
      console.error('Failed to insert intake submission:', error);
      return new Response('Something went wrong submitting your form. Please try again.', {
        status: 500,
      });
    }
    submissionId = data;

    // The same form submitted twice (double-click, back-and-resubmit): the
    // repeat goes to the Recycling Bin, sends no second email, and shows the
    // original's confirmation.
    const originalId = await flagDuplicateSubmission(submissionId);
    if (originalId) {
      return redirect(`${confirmationBase}?id=${originalId}`, 303);
    }
  }
  const confirmationUrl = `${confirmationBase}?id=${submissionId}`;

  // Admin notification emails are only sent for the Contact Me form — group
  // and events registrations show up in /admin/analytics and /admin/inbox
  // without paging the admin's inbox for every sign-up. Those two class-
  // registration flows instead email each dancer who provided an email a
  // confirmation of their own, matching what /register/confirmation shows.
  let ip = 'unknown';
  try {
    ip = clientAddress;
  } catch {
    // clientAddress can throw if the adapter doesn't support it — fall back to a shared bucket.
  }

  if (registrationType !== 'private') {
    try {
      // Built from what was just saved, the same email an admin can resend later.
      const confirmation = await buildRegistrationConfirmation(submissionId, { guidelines });
      const emailRecipients = confirmation?.recipients ?? [];
      // Admins who want a copy of every confirmation (Settings → Registration
      // Confirmation BCC), minus anyone already getting it as a dancer.
      const dancerAddresses = new Set(emailRecipients.map((e) => e.toLowerCase()));
      const bcc = (await getConfirmationBccEmails()).filter((e) => !dancerAddresses.has(e.toLowerCase()));

      if (confirmation && (emailRecipients.length > 0 || bcc.length > 0)) {
        const { subject, html } = confirmation;

        // Per-IP throttle on confirmation emails only — the registration itself is
        // already saved, so a capped network (e.g. a room full of dancers on one
        // wifi) just misses the email. Checked before the global cap so a
        // throttled IP doesn't use up everyone else's quota.
        const perIpCap = await getConfirmationEmailPerIpCap();
        let capped = false;
        const reserveEmail = async () => {
          if (capped) return false;
          if (!(await checkAndIncrementUsage(`confirmation_email_ip:${ip}`, perIpCap))) {
            console.warn('Per-IP confirmation email cap reached — skipping remaining confirmation emails for this network.');
            capped = true;
          } else if (!(await checkAndIncrementUsage('resend_confirmation_email', CONFIRMATION_EMAIL_DAILY_CAP))) {
            console.warn('Daily confirmation email cap reached — skipping remaining registration confirmation emails.');
            capped = true;
          }
          return !capped;
        };

        const toSend: string[] = [];
        for (const recipient of emailRecipients) {
          if (!(await reserveEmail())) break;
          toSend.push(recipient);
        }

        // One admin copy per registration, sent on its own (reserved after the
        // dancers' emails, so it never uses up their quota) so a failed dancer
        // send can't lose it. The admins after the first are BCC'd, so they
        // don't see each other's addresses.
        const sends = toSend.map((recipient) => sendEmail(recipient, subject, html));
        if (bcc.length > 0 && (await reserveEmail())) {
          sends.push(sendEmail(bcc[0], subject, html, { bcc: bcc.slice(1) }));
        }
        const results = await Promise.allSettled(sends);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Failed to send registration confirmation to a recipient:', r.reason);
        }
      }
    } catch (err) {
      console.error('Failed to send registration confirmation email:', err);
      // The submission itself already succeeded and is safely in the database.
    }

    return redirect(confirmationUrl, 303);
  }

  try {
    // Per-IP throttle on the admin notification only — the submission is already
    // saved and shows up in /admin/inbox. Checked before the global cap so a
    // throttled IP doesn't use up the quota real visitors rely on.
    const contactIpAllowed = await checkAndIncrementUsage(`contact_email_ip:${ip}`, await getContactEmailPerIpCap());
    if (!contactIpAllowed) {
      console.warn('Per-IP contact notification cap reached — skipping admin notification for this submission.');
      return redirect(confirmationUrl, 303);
    }

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

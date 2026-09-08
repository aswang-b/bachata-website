import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { sendAdminNotification } from '../../lib/email';
import { checkAndIncrementUsage } from '../../lib/apiUsage';
import { env } from '../../lib/env';

export const prerender = false;

// Hard daily cap on admin notification emails, as a backstop against a spam
// bot hammering the public intake form and running up Resend cost — the form
// submission itself is never blocked by this, only the notification email.
const EMAIL_DAILY_CAP = Number(env('RESEND_DAILY_CAP')) || 200;

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
      !paymentMethod ||
      !dancers ||
      dancers.length === 0 ||
      !dancers.every((d) => d.firstName && d.lastName && d.role)
    ) {
      return new Response(
        'Missing required fields: a class, a payment method, and each dancer\'s first name, last name, and role.',
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

    if (!firstName || !lastName || !hasAnyContactMethod) {
      return new Response('Missing required fields: First Name, Last Name, and a way to contact you are required.', {
        status: 400,
      });
    }
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

  const confirmationBase = registrationType === 'private' ? '/contact/confirmation' : '/register/confirmation';
  const confirmationUrl = `${confirmationBase}?id=${row.id}`;

  // Admin notification emails are only sent for the Contact Me form — group
  // and events registrations show up in /admin/analytics and /admin/inbox
  // without paging the admin's inbox for every sign-up.
  if (registrationType !== 'private') {
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

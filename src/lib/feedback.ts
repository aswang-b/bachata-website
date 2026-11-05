import { normalizeName } from './attendanceMatching';

// Feedback requests (migration 0064), the parts shared by the server, the
// emails and the admin page's script: the rating faces, who to ask, and
// WhatsApp links. Pure, so it's safe in the browser bundle.

export const RATINGS = [
  { value: 1, emoji: '😞', label: 'Not great' },
  { value: 2, emoji: '🙁', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😍', label: 'Loved it' },
] as const;

export interface FeedbackRecipient {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

// Identifies a dancer on the list the admin ticked (recipients are worked out afresh on save).
export const recipientKey = (r: FeedbackRecipient) => [r.firstName, r.lastName, r.email ?? '', r.phone ?? ''].join('|');

const digits = (phone: string | null) => (phone ?? '').replace(/\D/g, '');

// The same dancer turns up once per class they came to (and on both a
// check-in and a sign-up): one invite each. Same name is only the same
// person when their email or phone agrees, or one side has neither, so two
// namesakes with different contacts are both asked. Merged contacts fill in
// each other's blanks.
export function dedupeRecipients(people: FeedbackRecipient[]): FeedbackRecipient[] {
  const out: FeedbackRecipient[] = [];
  for (const p of people) {
    const email = p.email?.trim().toLowerCase() || null;
    const phone = p.phone?.trim() || null;
    const name = normalizeName(p.firstName, p.lastName);
    const same = out.find((o) => {
      if (normalizeName(o.firstName, o.lastName) !== name) return false;
      if ((!email && !phone) || (!o.email && !o.phone)) return true;
      return Boolean((email && o.email === email) || (phone && digits(o.phone) === digits(phone)));
    });
    if (same) {
      same.email ??= email;
      same.phone ??= phone;
    } else {
      out.push({ firstName: p.firstName.trim(), lastName: p.lastName.trim(), email, phone });
    }
  }
  return out;
}

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;
const MAX_TYPED_PEOPLE = 200;
const MAX_NAME = 100;

// Dancers typed in for a request. Each needs a first name and a way to reach
// them, or the request could never get to them. Wholly blank rows are skipped.
export function cleanTypedPeople(raw: unknown): { people: FeedbackRecipient[] } | { error: string } {
  if (raw === undefined || raw === null) return { people: [] };
  if (!Array.isArray(raw) || raw.length > MAX_TYPED_PEOPLE) return { error: `Add up to ${MAX_TYPED_PEOPLE} dancers.` };
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const people: FeedbackRecipient[] = [];
  for (const row of raw) {
    const [firstName, lastName, email, phone] = ['firstName', 'lastName', 'email', 'phone'].map((k) => text(row?.[k]));
    if (!firstName && !lastName && !email && !phone) continue;
    if (!firstName) return { error: `Add a first name for ${lastName || email || phone}.` };
    if (firstName.length > MAX_NAME || lastName.length > MAX_NAME) return { error: `${firstName}'s name is too long.` };
    if (!email && !phone) return { error: `Add an email or WhatsApp number for ${firstName}.` };
    if (email && !EMAIL_RE.test(email)) return { error: `${firstName}'s email doesn't look right.` };
    if (phone && !whatsappNumber(phone)) return { error: `${firstName}'s WhatsApp number doesn't look right. Include the country code if it's outside the US.` };
    people.push({ firstName, lastName, email: email || null, phone: phone || null });
  }
  return { people: dedupeRecipients(people) };
}

// A phone number as wa.me wants it: country code and digits only. Ten digits
// are taken as a US number; with a + (or 11+ digits) the code is already there.
export function whatsappNumber(phone: string | null): string | null {
  const d = digits(phone);
  if (d.length === 10 && !phone!.trim().startsWith('+')) return `1${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

// The WhatsApp message: the request's own message (already filled in), or a
// default greeting, then the link.
export function feedbackMessage(lead: string | null, firstName: string, className: string, link: string): string {
  const opening = lead ?? `Hi ${firstName}! Thanks for dancing with us at ${className} 💃 How was it?`;
  return `${opening}\n\nTap to answer anonymously, it takes a few seconds: ${link}`;
}

export function whatsappUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

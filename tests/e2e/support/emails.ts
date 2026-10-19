import { existsSync, readFileSync } from 'node:fs';
import { EMAIL_SINK } from './env';

// Emails the test dev server "sent": with E2E_EMAIL_SINK set, sendEmail
// appends each one to this file instead of calling Resend.
export interface SunkEmail {
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  at: string;
}

export function sunkEmails(): SunkEmail[] {
  if (!existsSync(EMAIL_SINK)) return [];
  return readFileSync(EMAIL_SINK, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SunkEmail);
}

export const recipients = (e: SunkEmail) => (Array.isArray(e.to) ? e.to : [e.to]);

// Emails whose body mentions `marker` (e.g. a test dancer's unique name).
export const emailsAbout = (marker: string) => sunkEmails().filter((e) => e.html.includes(marker) || e.subject.includes(marker));

import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { EMAIL_SINK, WEBHOOK_SECRET } from './env';

// Emails the test dev server "sent": with E2E_EMAIL_SINK set, sendEmail
// appends each one to this file instead of calling Resend.
export interface SunkEmail {
  // Stands in for Resend's email id (webhook events name it).
  id?: string;
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

// Posts a Resend webhook event to the site, signed with the test secret.
export async function postResendEvent(request: APIRequestContext, type: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ type, data });
  const id = `msg_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signature = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
  return request.post('/api/resend-webhook', { headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature }, data: body });
}

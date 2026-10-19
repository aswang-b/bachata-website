import { appendFileSync } from 'node:fs';

// Switches the end-to-end test suite (tests/e2e) turns on for its own dev
// server, so a test run against the shared database never emails anyone,
// never touches Google Calendar, and never uses up the real daily email and
// check-in quotas. Read from process.env (the test runner sets them) and only
// honored by the dev server: a production build ignores them entirely.
const devServer = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
const flag = (name: string) => (devServer ? process.env[name] : undefined);

// File that outgoing emails are appended to (one JSON object per line) instead of being sent.
export function emailSinkPath(): string | null {
  return flag('E2E_EMAIL_SINK') || null;
}

export function recordSunkEmail(email: { to: string | string[]; bcc?: string[]; subject: string; html: string }): void {
  const path = emailSinkPath();
  if (path) appendFileSync(path, JSON.stringify({ ...email, at: new Date().toISOString() }) + '\n');
}

// Behave as if no admin has connected Google Calendar.
export function googleDisabled(): boolean {
  return flag('E2E_DISABLE_GOOGLE') === '1';
}

// Don't count against (or be blocked by) the per-IP and daily usage caps.
export function usageCountersDisabled(): boolean {
  return flag('E2E_SKIP_USAGE_COUNTERS') === '1';
}

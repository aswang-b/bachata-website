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

export function recordSunkEmail(email: { id?: string; to: string | string[]; bcc?: string[]; subject: string; html: string }): void {
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

// The suite's own classes and events are saved with visibility 'test'
// (migration 0060). Only the test server shows them, as if public; the live
// site, and any other dev server, never does, so a run never shows on it.
export function showsTestEvents(): boolean {
  return flag('E2E_TEST_EVENTS') === '1';
}

// The visibilities public pages list: 'public', plus 'test' on the test server.
export function publicVisibilities(): string[] {
  return showsTestEvents() ? ['public', 'test'] : ['public'];
}

// Every visibility this server lists (admin pages, and a class looked up by
// its id, e.g. a check-in QR for a private class): public and private, plus
// 'test' on the test server.
export function allVisibilities(): string[] {
  return showsTestEvents() ? ['public', 'private', 'test'] : ['public', 'private'];
}

// A new event's visibility: always 'test' on the test server, so one an e2e
// test creates through the editor never shows on the live site.
export function newEventVisibility(requested: unknown): 'public' | 'private' | 'test' {
  if (showsTestEvents()) return 'test';
  return requested === 'private' ? 'private' : 'public';
}

// The suite's sign-ups, check-ins and messages start with ZZZ (case-sensitive,
// like its clean-up). Left out of the live admin lists; the test server shows them.
export const TEST_DATA_PREFIX = 'ZZZ';

export function hideTestRows<Q extends { not(column: string, operator: string, value: string): Q }>(query: Q, column = 'first_name'): Q {
  return showsTestEvents() ? query : query.not(column, 'like', `${TEST_DATA_PREFIX}%`);
}

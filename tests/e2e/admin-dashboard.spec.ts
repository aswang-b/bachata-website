import { test, expect } from './support/fixtures';
import { seedEvent, seedSignup, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { bearer } from './support/admin';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

let klass: Seeded;
let event: Seeded;

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Dashboard Class', occurrences: 2 });
  await seedSignup(klass, [
    { first: 'DashLead', role: 'leader' },
    { first: 'DashFollow', role: 'follower' },
  ]);
  event = await seedEvent({ name: 'Dashboard Event', type: 'event', dayOffset: 1 });
  await seedSignup(event, [{ first: 'DashGuest' }], 'events');
});

test('the dashboard data lists each dancer with their role and class, and keeps events in their own tab', async ({ request, admin }) => {
  const res = await request.get('/api/admin/analytics-data', { headers: bearer(admin) });
  expect(res.ok()).toBe(true);
  const data = await res.json();
  type Row = { firstName: string; lastName: string; role: string; classRegistrations: { classTitle: string; classLabel: string }[] };
  const ours = (data.signups as Row[]).filter((s) => s.lastName === RUN_ID && s.firstName.startsWith('ZZZDash'));
  expect(ours.map((s) => [s.firstName, s.role]).sort()).toEqual([
    ['ZZZDashFollow', 'follower'],
    ['ZZZDashLead', 'leader'],
  ]);
  expect(ours[0].classRegistrations[0].classTitle).toBe(klass.title);
  // Event tickets aren't sign-ups: they're listed separately.
  expect((data.signups as Row[]).some((s) => s.firstName === 'ZZZDashGuest')).toBe(false);
  expect(JSON.stringify(data.eventRegistrations)).toContain('ZZZDashGuest');
});

test('the dashboard page loads for an admin without script errors', async ({ page, adminPage, pageErrors }) => {
  void adminPage;
  await page.goto('/admin/analytics');
  await expect(page.locator('body')).toContainText('ZZZDashLead', { timeout: 30_000 });
  expect(pageErrors).toEqual([]);
});

test('the check-in QR tool makes a QR for a class', async ({ request, admin }) => {
  const res = await request.post('/api/admin/generate-checkin-qr', { headers: bearer(admin), data: { eventIds: [klass.ids[0]] } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(JSON.stringify(body)).toContain('data:image');
  expect(JSON.stringify(body)).toContain(`/check-in/${klass.ids[0]}`);
});

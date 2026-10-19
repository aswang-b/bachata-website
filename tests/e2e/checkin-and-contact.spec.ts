import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout, recipients } from './support/emails';

let klass: Seeded;

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Checkin Class' });
});

test('checking in to a class from its QR page saves the check-in and confirms it', async ({ page }) => {
  await page.goto(`/check-in/${klass.ids[0]}`);
  await expect(page.locator('body')).toContainText(klass.title);
  await page.locator('input[name="first_name"]').fill('ZZZCheck');
  await page.locator('input[name="last_name"]').fill(RUN_ID);
  await page.locator('input[name="phone"]').fill('6085550177');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/check-in\/confirmation\?ids=/);
  await expect(page.locator('body')).toContainText(klass.title);

  const { data } = await db.from('class_checkins').select('event_id, deleted_at').ilike('first_name', 'ZZZCheck').eq('last_name', RUN_ID);
  expect(data).toEqual([{ event_id: klass.ids[0], deleted_at: null }]);
});

test('checking in twice to the same class keeps one and bins the duplicate', async ({ request }) => {
  const fields = { first_name: 'ZZZTwiceIn', last_name: RUN_ID, phone: '(608) 555-0188', event_ids: klass.ids[0] };
  const first = await postForm(request, '/api/submit-checkin', fields);
  const second = await postForm(request, '/api/submit-checkin', { ...fields, phone: '608-555-0188' });
  expect(first.status()).toBe(303);
  expect(second.status()).toBe(303);
  const { data } = await db.from('class_checkins').select('deleted_by').ilike('first_name', 'ZZZTwiceIn').eq('last_name', RUN_ID).order('created_at');
  expect(data!.map((r) => r.deleted_by)).toEqual([null, 'Duplicate (auto-detected)']);
});

test('a check-in needs a name, phone and class', async ({ request }) => {
  const res = await postForm(request, '/api/submit-checkin', { first_name: 'ZZZNoPhone', last_name: RUN_ID, event_ids: klass.ids[0] });
  expect(res.status()).toBe(400);
});

test('the contact form saves the message and notifies the admins', async ({ page }) => {
  await page.goto('/contact');
  await page.locator('input[name="first_name"]').fill('ZZZContact');
  await page.locator('input[name="last_name"]').fill(RUN_ID);
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('input[name="email"]').fill(`zzz-e2e-${RUN_ID.toLowerCase()}-contact@example.com`);
  const phone = page.locator('input[name="phone"]');
  if (await phone.isVisible()) await phone.fill('6085550199');
  const comments = page.locator('textarea[name="comments"]');
  if (await comments.isVisible()) await comments.fill(`ZZZ test message ${RUN_ID}`);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/contact\/confirmation/);

  const { data } = await db.from('intake_submissions').select('registration_type').ilike('first_name', 'ZZZContact').eq('last_name', RUN_ID);
  expect(data).toEqual([{ registration_type: 'private' }]);

  const { data: settings } = await db.from('notification_settings').select('recipient_emails').eq('id', true).maybeSingle();
  const admins = String(settings?.recipient_emails ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  const sent = emailsAbout(`ZZZContact ${RUN_ID}`);
  if (admins.length > 0) {
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Website Contact Request - ZZZContact ${RUN_ID}`);
    expect(recipients(sent[0])).toEqual(admins);
  }
});

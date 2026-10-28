import { createHmac } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData } from './support/db';
import { RUN_ID, WEBHOOK_SECRET } from './support/env';
import { bearer } from './support/admin';
import { recipients, sunkEmails } from './support/emails';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Catching a mistyped email: a "Did you mean …?" fix for a likely typo, a
// note when the domain can't receive mail (both stop the first submit only),
// and the dashboard flagging an address Resend reported bouncing.
const run = RUN_ID.toLowerCase();

test('the contact form suggests a fix for a typo, and flags a domain that can\'t receive email', async ({ page }) => {
  await page.goto('/contact');
  await page.locator('input[name="first_name"]').fill('ZZZEmailCheck');
  await page.locator('input[name="last_name"]').fill(RUN_ID);
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  const email = page.locator('input[name="email"]');
  const hint = page.locator('.email-hint');

  await email.fill(`zzz-${run}@gmial.com`);
  await email.blur();
  await expect(hint).toHaveText(`Did you mean zzz-${run}@gmail.com?`);
  await hint.locator('.email-hint-fix').click();
  await expect(email).toHaveValue(`zzz-${run}@gmail.com`);
  await expect(hint).toBeHidden();

  // A domain with no mail servers: the first submit stops at the note, the second goes ahead.
  await email.fill(`zzz-${run}@no-such-domain-${run}.com`);
  await page.locator('textarea[name="comments"]').fill(`ZZZ email check ${RUN_ID}`);
  await page.locator('form button[type="submit"]').click();
  await expect(hint).toContainText(`We couldn't find the email domain "no-such-domain-${run}.com"`);
  await expect(hint).toContainText('Or submit again to use it as typed.');
  await expect(page).toHaveURL(/\/contact$/);
  await expect(email).toBeFocused();
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/contact\/confirmation/);
});

test('a dancer\'s mistyped email on the registration form gets the same note', async ({ page }) => {
  const klass = await seedEvent({ name: 'Email Check Class', dayOffset: 44 });
  await page.goto(`/register?series=${klass.key}`);
  const email = page.locator('.dancer-block').first().locator('.dancer-email');
  await email.fill(`zzz-${run}@yahooo.com`);
  await email.blur();
  await expect(page.locator('.dancer-block').first().locator('.email-hint')).toHaveText(`Did you mean zzz-${run}@yahoo.com?`);
});

test('a bounce reported by Resend is recorded and flagged on the dashboard', async ({ page, request, adminPage }) => {
  void adminPage;
  const bounced = `zzz-bounce-${run}@example.com`;
  const klass = await seedEvent({ name: 'Bounce Class', dayOffset: 45 });
  await seedSignup(klass, [{ first: 'Bounced', role: 'leader', email: bounced }]);

  const body = JSON.stringify({ type: 'email.bounced', data: { to: [bounced], bounce: { type: 'Permanent', message: 'Mailbox does not exist' } } });
  const id = `msg_${run}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signature = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;

  const forged = await request.post('/api/resend-webhook', { headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' }, data: body });
  expect(forged.status()).toBe(401);

  const res = await request.post('/api/resend-webhook', { headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature }, data: body });
  expect(res.status()).toBe(200);
  const { data } = await db.from('email_bounces').select('email, bounce_type, reason').eq('email', bounced).single();
  expect(data).toEqual({ email: bounced, bounce_type: 'Permanent', reason: 'Mailbox does not exist' });

  await page.goto('/admin/analytics');
  const row = page.locator('tr', { hasText: 'ZZZBounced' }).first();
  await expect(row.locator('.email-bounced')).toHaveText('Email bounced');
  await expect(row.locator('.email-bounced')).toHaveAttribute('title', /Mailbox does not exist/);
});

test('an admin can resend a confirmation, e.g. after fixing an address that bounced', async ({ request, admin }) => {
  const klass = await seedEvent({ name: 'Resend Class', dayOffset: 46 });
  const typo = `zzz-resend-${run}@gmial.com`;
  const fixed = `zzz-resend-${run}@example.com`;
  const submissionId = await seedSignup(klass, [{ first: 'Resend', role: 'follower', email: typo }]);

  // The admin corrects the address (as the dashboard's Edit does), then resends.
  const { data: sub } = await db.from('intake_submissions').select('dancers').eq('id', submissionId).single();
  const dancers = (sub!.dancers as { email: string }[]).map((d) => ({ ...d, email: fixed }));
  await db.from('intake_submissions').update({ dancers, email: fixed }).eq('id', submissionId);

  const res = await request.post('/api/admin/resend-confirmation', { headers: bearer(admin), data: { submissionId } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toMatchObject({ sent: [fixed], failed: [] });

  const sent = sunkEmails().filter((e) => recipients(e).includes(fixed));
  expect(sent).toHaveLength(1);
  expect(sent[0].subject).toBe('Your Class Registration is Confirmed — Dance with B');
  expect(sent[0].html).toContain(klass.title);
  expect(sunkEmails().some((e) => recipients(e).includes(typo))).toBe(false);

  const missing = await request.post('/api/admin/resend-confirmation', { headers: bearer(admin), data: { submissionId: '00000000-0000-0000-0000-000000000000' } });
  expect(missing.status()).toBe(404);
});

test.describe('the Errors workqueue', () => {
  test('a bounce shows with its sign-up: update the email, then resend to it with the admin copies', async ({ page, request, adminPage }) => {
    void adminPage;
    const bounced = `zzz-queue-${run}@gmial.com`;
    const fixed = `zzz-queue-${run}@example.com`;
    const klass = await seedEvent({ name: 'Queue Class', dayOffset: 48 });
    const submissionId = await seedSignup(klass, [{ first: 'Queue', role: 'leader', email: bounced }]);

    const body = JSON.stringify({ type: 'email.bounced', data: { to: [bounced], bounce: { type: 'Permanent', message: 'Domain not found' } } });
    const id = `msg_q_${run}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
    const signature = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
    const res = await request.post('/api/resend-webhook', { headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature }, data: body });
    expect(res.status()).toBe(200);

    await page.goto('/admin/analytics');
    await page.locator('.tab-btn[data-tab="errors"]').click();
    const item = page.locator('.site-error', { hasText: bounced });
    await expect(item).toContainText(`Email to ${bounced} bounced: Domain not found`);
    await expect(item.locator('.bounce-signup')).toContainText('ZZZQueue');
    await page.locator('#tab-panel-errors').screenshot({ path: 'tests/e2e/.output/errors-queue.png' });

    await item.locator('.bounce-email').fill(fixed);
    await item.locator('.bounce-update-btn').click();
    await expect(item).toContainText('Email updated on the registration.');
    const { data: sub } = await db.from('intake_submissions').select('email, dancers').eq('id', submissionId).single();
    expect((sub!.dancers as { email: string }[])[0].email).toBe(fixed);
    expect(sub!.email).toBe(fixed);
    const { data: regs } = await db.from('class_registrations').select('email').eq('submission_id', submissionId);
    expect(regs!.every((r) => r.email === fixed)).toBe(true);

    page.once('dialog', (d) => void d.accept());
    await item.locator('.bounce-resend-btn').click();
    await expect(page.locator('#errors-status')).toContainText(`Sent to ${fixed}. The error is resolved.`);
    await expect(page.locator('.site-error', { hasText: bounced })).toHaveCount(0);

    const sent = sunkEmails().filter((e) => recipients(e).includes(fixed));
    expect(sent).toHaveLength(1);
    const { data: settings } = await db.from('notification_settings').select('confirmation_bcc_emails').eq('id', true).maybeSingle();
    const admins = String(settings?.confirmation_bcc_emails ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    expect([...(sent[0].bcc ?? [])].sort()).toEqual(admins.sort());
    const { data: closed } = await db.from('site_errors').select('status').eq('dedupe_key', `bounce:${bounced}`).single();
    expect(closed!.status).toBe('resolved');
  });

  test('any error can be dismissed, and a repeat of an open one adds to its count', async ({ page, adminPage }) => {
    void adminPage;
    const message = `ZZZ test error ${RUN_ID}`;
    for (let i = 0; i < 2; i++) await db.rpc('log_site_error', { p_kind: 'google_api', p_message: message, p_details: {}, p_dedupe_key: `zzz-test:${RUN_ID}` });
    await page.goto('/admin/analytics');
    await expect(page.locator('#errors-tab-count')).not.toHaveText('');
    await page.locator('.tab-btn[data-tab="errors"]').click();
    const item = page.locator('.site-error', { hasText: message });
    await expect(item).toContainText('2 times since');
    await item.locator('.site-error-dismiss').click();
    await expect(page.locator('.site-error', { hasText: message })).toHaveCount(0);
    const { data } = await db.from('site_errors').select('status').eq('dedupe_key', `zzz-test:${RUN_ID}`).single();
    expect(data!.status).toBe('dismissed');
  });
});

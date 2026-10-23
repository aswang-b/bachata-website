import { createHmac } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup } from './support/db';
import { RUN_ID, WEBHOOK_SECRET } from './support/env';
import { bearer } from './support/admin';
import { recipients, sunkEmails } from './support/emails';

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

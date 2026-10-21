import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, spotCounts, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout, recipients } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';
import { bearer } from './support/admin';

let series: Seeded;
let wholeOnly: Seeded;
let dropInOnly: Seeded;
let closed: Seeded;

test.beforeAll(async () => {
  series = await seedEvent({ name: 'Bachata Series', occurrences: 2, priceWhole: 50, priceDropIn: 15 });
  wholeOnly = await seedEvent({ name: 'Whole Only', occurrences: 2, priceWhole: 40, priceDropIn: null, dayOffset: 1 });
  dropInOnly = await seedEvent({ name: 'Practica', occurrences: 2, priceWhole: null, priceDropIn: 10, dayOffset: 2 });
  closed = await seedEvent({ name: 'Closed Class', registrationClosed: true, dayOffset: 3 });
});

async function bccList(): Promise<string[]> {
  const { data } = await db.from('notification_settings').select('confirmation_bcc_emails').eq('id', true).maybeSingle();
  return String(data?.confirmation_bcc_emails ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

test('a group signs up for a whole series and gets an itemized confirmation page and email', async ({ page }) => {
  const email = `zzz-e2e-${RUN_ID.toLowerCase()}-lead@example.com`;
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Lead', role: 'leader', email });
  await fillDancer(page, 1, { first: 'Follow', role: 'follower' });

  // The live subtotal itemizes the class per dancer.
  await expect(page.locator('#subtotal-items')).toContainText('$50 × 2 dancers');
  await expect(page.locator('#subtotal-value')).toHaveText('$100');
  await payCash(page);
  await submitRegistration(page);

  await page.waitForURL(/\/register\/confirmation\?id=/);
  const body = page.locator('body');
  await expect(body).toContainText('Your Registration is Confirmed!');
  await expect(body).toContainText('Whole Series');
  await expect(body).toContainText('$50 × 2 dancers');
  await expect(body).toContainText('$100');
  await expect(body).toContainText('You agreed to pay with cash.');
  await expect(body).toContainText('leader');
  // Classes list the FAQ reminders (when there are FAQs), never the event guidelines.
  await expect(body).not.toContainText('Our Community Guidelines');

  // Saved per dancer, under the series, and counted by role.
  const id = confirmationId(page.url())!;
  const { data: regs } = await db.from('class_registrations').select('series_key, series_mode, price').eq('submission_id', id);
  expect(regs).toHaveLength(2);
  expect(regs!.every((r) => r.series_key === series.key && r.series_mode === 'whole' && Number(r.price) === 50)).toBe(true);
  for (const occ of series.ids) expect(await spotCounts(occ)).toMatchObject({ taken: 2, leaders_taken: 1, followers_taken: 1 });

  // One confirmation to the dancer who gave an email, plus one admin copy when BCC is set (never BCC'ing the dancer).
  const sent = emailsAbout(`ZZZLead`).filter((e) => e.html.includes(RUN_ID));
  const toDancer = sent.filter((e) => recipients(e).includes(email));
  expect(toDancer).toHaveLength(1);
  expect(toDancer[0].subject).toContain('Class Registration is Confirmed');
  expect(toDancer[0].html).toContain('$50 × 2 dancers');
  const bcc = (await bccList()).filter((e) => e.toLowerCase() !== email);
  const adminCopies = sent.filter((e) => !recipients(e).includes(email));
  expect(adminCopies).toHaveLength(bcc.length > 0 ? 1 : 0);
  if (bcc.length > 0) {
    expect(recipients(adminCopies[0])).toEqual([bcc[0]]);
    expect(adminCopies[0].bcc ?? []).toEqual(bcc.slice(1));
  }
});

test('a drop-in has to pick its class date, and the receipt names that date', async ({ page }) => {
  await page.goto(`/register?series=${series.key}`);
  const item = await selectSeries(page, series.key);
  await item.locator('.series-mode-radio[value="dropin"]').check();
  await fillDancer(page, 0, { first: 'DropIn', role: 'follower' });
  await payCash(page);
  await submitRegistration(page);
  await expect(item.locator('.occurrence-error')).toBeVisible();
  await expect(page).toHaveURL(/\/register\?/);

  await item.locator('.occurrence-btn').first().click();
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  await expect(page.locator('body')).toContainText('Drop In ·');
  await expect(page.locator('body')).toContainText('$15');
});

test('a class with only a whole-series price shows it selected, and clicking it again unselects the class', async ({ page }) => {
  await page.goto('/register');
  const item = await selectSeries(page, wholeOnly.key);
  const radio = item.locator('.series-mode-radio[value="whole"]');
  await expect(radio).toBeChecked();
  await radio.click();
  await expect(item).toHaveAttribute('data-selected', 'false');
});

test('a drop-in-only class preselects Drop In and asks for the date', async ({ page }) => {
  await page.goto('/register');
  const item = await selectSeries(page, dropInOnly.key);
  await expect(item.locator('.series-mode-radio[value="dropin"]')).toBeChecked();
  await expect(item.locator('.dropin-occurrence-picker')).toBeVisible();
});

test('a closed class is shown but cannot be picked, and the server refuses it', async ({ page, request }) => {
  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${closed.key}"]`);
  await expect(item).toContainText('Registration Closed');
  // Marked disabled for screen readers too; clicked anyway to prove it stays unpicked.
  await expect(item.locator('.series-toggle-btn')).toHaveAttribute('aria-disabled', 'true');
  await item.locator('.series-toggle-btn').click({ force: true });
  await expect(item).not.toHaveAttribute('data-selected', 'true');

  const res = await postForm(request, '/api/submit-intake', {
    registration_type: 'group',
    class: closed.title,
    payment_method: 'cash',
    class_selections: JSON.stringify([{ key: closed.key, title: closed.title, label: '', mode: null }]),
    dancers: JSON.stringify([{ firstName: 'ZZZClosed', lastName: RUN_ID, role: 'leader', phone: '6085550100', email: '' }]),
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('closed');
});

test('the server rejects malformed sign-ups with a clear message', async ({ request }) => {
  const base = {
    registration_type: 'group',
    class: series.title,
    payment_method: 'cash',
    class_selections: JSON.stringify([{ key: series.key, title: series.title, label: '', mode: 'whole' }]),
  };
  const dancer = { firstName: 'ZZZBad', lastName: RUN_ID, role: 'leader', phone: '6085550100', email: '' };

  const badEmail = await postForm(request, '/api/submit-intake', { ...base, dancers: JSON.stringify([{ ...dancer, email: 'not-an-email' }]) });
  expect(badEmail.status()).toBe(400);
  expect(await badEmail.text()).toContain('valid format');

  const noRole = await postForm(request, '/api/submit-intake', { ...base, dancers: JSON.stringify([{ ...dancer, role: '' }]) });
  expect(noRole.status()).toBe(400);

  const tooMany = await postForm(request, '/api/submit-intake', { ...base, dancers: JSON.stringify(Array(6).fill(dancer)) });
  expect(tooMany.status()).toBe(400);

  const noPayment = await postForm(request, '/api/submit-intake', { ...base, payment_method: '', dancers: JSON.stringify([dancer]) });
  expect(noPayment.status()).toBe(400);
});

test('a double-submitted sign-up goes to the Recycling Bin and shows the original; an admin can restore it', async ({ request, admin }) => {
  const fields = {
    registration_type: 'group',
    class: series.title,
    payment_method: 'venmo',
    class_selections: JSON.stringify([{ key: series.key, title: series.title, label: '', mode: 'whole' }]),
    dancers: JSON.stringify([{ firstName: 'ZZZTwice', lastName: RUN_ID, role: 'follower', phone: '6085550111', email: '' }]),
  };
  const first = await postForm(request, '/api/submit-intake', fields);
  const second = await postForm(request, '/api/submit-intake', fields);
  expect(first.status()).toBe(303);
  expect(second.status()).toBe(303);
  const originalId = new URL(first.headers().location, 'http://x').searchParams.get('id');
  expect(second.headers().location).toBe(first.headers().location);

  const { data: rows } = await db.from('intake_submissions').select('id, deleted_at, deleted_by, deletion_id').ilike('first_name', 'ZZZTwice').eq('last_name', RUN_ID);
  const dup = rows!.find((r) => r.id !== originalId)!;
  expect(dup.deleted_by).toBe('Duplicate (auto-detected)');
  expect(rows!.find((r) => r.id === originalId)!.deleted_at).toBeNull();

  // It's listed in the admin Recycling Bin and can be restored (under the bin's edit lock).
  const bin = await (await request.get('/api/admin/recycling-bin', { headers: bearer(admin) })).json();
  expect(bin.items.some((i: { deletionId: string }) => i.deletionId === dup.deletion_id)).toBe(true);
  const holderId = `e2e-${RUN_ID}`;
  expect((await request.post('/api/admin/acquire-lock', { headers: bearer(admin), data: { resource: 'recycling', holderId } })).ok()).toBe(true);
  try {
    const restore = await request.post('/api/admin/recycling-bin', { headers: bearer(admin), data: { action: 'restore', deletionId: dup.deletion_id, holderId } });
    expect(restore.ok()).toBe(true);
  } finally {
    await request.post('/api/admin/release-lock', { headers: bearer(admin), data: { resource: 'recycling', holderId } });
  }
  const { data: restored } = await db.from('intake_submissions').select('deleted_at').eq('id', dup.id).single();
  expect(restored!.deleted_at).toBeNull();
});

test('a blocked submit jumps to the first problem: a missing dancer detail, then the payment choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  // First name left empty; everything below the dancers left for later.
  await page.locator('.dancer-block').first().locator('.dancer-role-btn[data-role="leader"]').click();
  await page.locator('.dancer-block').first().locator('.dancer-phone').fill('6085550100');
  await page.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
  await submitRegistration(page);

  const firstName = page.locator('.dancer-block').first().locator('.dancer-first-name');
  await expect(firstName).toBeFocused();
  await expect(firstName).toBeInViewport();

  // Dancer filled in: the next problem is the missing payment choice.
  await fillDancer(page, 0, { first: 'JumpTest', role: 'leader' });
  await page.locator('#dancers-value').evaluate(() => window.scrollTo(0, 0));
  await submitRegistration(page);
  await expect(page.locator('#payment-error')).toBeVisible();
  await expect(page.locator('#payment-error')).toBeInViewport();
  await expect(page).toHaveURL(/\/register\?/);
});

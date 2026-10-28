import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, spotCounts, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout, postResendEvent, recipients } from './support/emails';
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
  closed = await seedEvent({ name: 'Closed Class', registrationClosed: true, dayOffset: 3, description: '<p>Back next term.</p>' });
});

async function bccList(): Promise<string[]> {
  const { data } = await db.from('notification_settings').select('confirmation_bcc_emails').eq('id', true).maybeSingle();
  return String(data?.confirmation_bcc_emails ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

test('a group signs up for a whole series and gets an itemized confirmation page and email', async ({ page, request }) => {
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

  // One confirmation to the dancer who gave an email, on its own.
  const sent = emailsAbout(`ZZZLead`).filter((e) => e.html.includes(RUN_ID));
  expect(sent).toHaveLength(1);
  const toDancer = sent[0];
  expect(recipients(toDancer)).toEqual([email]);
  expect(toDancer.bcc).toBeUndefined();
  expect(toDancer.subject).toContain('Class Registration is Confirmed');
  expect(toDancer.html).toContain('$50 × 2 dancers');

  // The admins' copy (Confirmation BCC setting) waits until Resend reports the dancer's email delivered.
  const admins = await bccList();
  const adminCopies = () => emailsAbout(`ZZZLead`).filter((e) => e.html.includes(RUN_ID) && !recipients(e).includes(email));
  expect(adminCopies()).toHaveLength(0);
  expect((await postResendEvent(request, 'email.delivered', { email_id: toDancer.id, to: [email] })).status()).toBe(200);
  expect(adminCopies()).toHaveLength(admins.length > 0 ? 1 : 0);
  if (admins.length > 0) {
    const copy = adminCopies()[0];
    expect(recipients(copy)).toEqual([admins[0]]);
    expect(copy.bcc ?? []).toEqual(admins.slice(1));
    expect(copy.subject).toBe(toDancer.subject);
    expect(copy.html).toBe(toDancer.html);
  }
  // A repeat of the event doesn't send it again.
  await postResendEvent(request, 'email.delivered', { email_id: toDancer.id, to: [email] });
  expect(adminCopies()).toHaveLength(admins.length > 0 ? 1 : 0);
});

test("a dancer's confirmation that bounces is noted in the admins' copy, and a resend is the plain confirmation", async ({ page, request, admin }) => {
  const admins = await bccList();
  test.skip(admins.length === 0, 'No admins are on the Confirmation BCC list.');
  const email = `zzz-e2e-${RUN_ID.toLowerCase()}-bounce@example.com`;
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Bouncy', role: 'leader', email });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  const submissionId = confirmationId(page.url())!;

  const [toDancer] = emailsAbout('ZZZBouncy').filter((e) => recipients(e).includes(email));
  const res = await postResendEvent(request, 'email.bounced', { email_id: toDancer.id, to: [email], bounce: { type: 'Permanent', message: 'Mailbox does not exist' } });
  expect(res.status()).toBe(200);
  const copies = emailsAbout('ZZZBouncy').filter((e) => !recipients(e).includes(email));
  expect(copies).toHaveLength(1);
  expect(recipients(copies[0])).toEqual([admins[0]]);
  expect(copies[0].subject).toBe(`Not delivered: ${toDancer.subject}`);
  expect(copies[0].html).toContain("This confirmation didn't reach the dancer:");
  expect(copies[0].html).toContain(`<strong>${email}</strong> — bounced: Mailbox does not exist`);
  expect(copies[0].html).toContain(toDancer.html);

  // After the address is fixed, a resend from the dashboard is the same confirmation, with no note.
  const fixed = `zzz-e2e-${RUN_ID.toLowerCase()}-fixed@example.com`;
  const { data: sub } = await db.from('intake_submissions').select('dancers').eq('id', submissionId).single();
  await db.from('intake_submissions').update({ email: fixed, dancers: (sub!.dancers as { email: string }[]).map((d) => ({ ...d, email: fixed })) }).eq('id', submissionId);
  expect((await request.post('/api/admin/resend-confirmation', { headers: bearer(admin), data: { submissionId } })).status()).toBe(200);
  const [resent] = emailsAbout('ZZZBouncy').filter((e) => recipients(e).includes(fixed));
  expect(resent.subject).toBe(toDancer.subject);
  expect(resent.html).toBe(toDancer.html.replaceAll(email, fixed));
});

test("with no dancer email to wait on, the admins' copy goes out right away", async ({ page }) => {
  const admins = await bccList();
  test.skip(admins.length === 0, 'No admins are on the Confirmation BCC list.');
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Phoneonly', role: 'follower', phone: '6085550123' });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  const copies = emailsAbout('ZZZPhoneonly');
  expect(copies).toHaveLength(1);
  expect(recipients(copies[0])).toEqual([admins[0]]);
  expect(copies[0].subject).toContain('Class Registration is Confirmed');
  expect(copies[0].html).not.toContain("didn't reach the dancer");
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
  // Announced as something that expands to its description (which it does),
  // not as a disabled button or a pickable one, and it stays unpicked.
  const toggle = item.locator('.series-toggle-btn');
  await expect(toggle).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(toggle).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(item.locator('.series-details')).toBeVisible();
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

test('a blocked submit is announced every time, even when the same message is already showing', async ({ page }) => {
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Announce', role: 'leader' });
  const announcer = page.locator('#form-error-announcer');
  await expect(announcer).toHaveAttribute('role', 'alert');
  for (let i = 0; i < 2; i++) {
    await submitRegistration(page);
    await expect(announcer).toHaveText('Please choose a payment method.');
    await expect(page.locator('#payment-error')).not.toHaveAttribute('role', /.*/);
  }
});

test('with no class picked, a blocked submit focuses a class that can be picked, never a closed one', async ({ page }) => {
  await page.goto('/register');
  // Put the closed class first, where the focus used to land on its hidden controls.
  await page.locator(`.series-item[data-key="${closed.key}"]`).evaluate((el) => el.parentElement!.prepend(el));
  await fillDancer(page, 0, { first: 'NoClass', role: 'leader' });
  await payCash(page);
  await submitRegistration(page);
  const focused = page.locator(':focus');
  await expect(focused).toHaveClass(/series-toggle-btn/);
  expect(await focused.evaluate((el) => el.closest('.series-item')?.getAttribute('data-registration-closed'))).toBe('false');
});

test('the drop-in policy note stays on a phone screen, and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/register?series=${series.key}`);
  const item = await selectSeries(page, series.key);
  await item.locator('button[aria-label="Drop-in policy"]').focus();
  const tip = item.locator('[role="tooltip"]');
  await expect(tip).toBeVisible();
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

// The location link sat inside the class row's role=button, whose Enter key
// handler swallowed the link's Enter (picking the class instead), and a
// button's contents aren't announced as controls of their own.
test("a class's location link is its own control: Enter on it opens the map, not the class", async ({ page }) => {
  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${series.key}"]`);
  const link = item.locator('a', { hasText: 'ZZZ Test Studio' });
  expect(await link.evaluate((el) => el.closest('[role="button"]'))).toBeNull();
  // Clicking the rest of the header (outside the button) still picks the class.
  await item.locator(`#series-sub-${series.key}`).click();
  await expect(item).toHaveAttribute('data-selected', 'true');
  await item.locator('.series-toggle-btn').click();
  await expect(item).not.toHaveAttribute('data-selected', 'true');

  await link.focus();
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  await (await popup).close();
  await expect(item).not.toHaveAttribute('data-selected', 'true');
});

test("the first dancer's fields say what they're for, and missing ones are marked invalid after a blocked submit", async ({ page }) => {
  await page.goto('/register');
  const first = page.locator('.dancer-block').first();
  await expect(first.locator('.dancer-first-name')).toHaveAttribute('autocomplete', 'given-name');
  await expect(first.locator('.dancer-last-name')).toHaveAttribute('autocomplete', 'family-name');
  await expect(first.locator('.dancer-phone')).toHaveAttribute('autocomplete', 'tel');
  await expect(first.locator('.dancer-email')).toHaveAttribute('autocomplete', 'email');
  // A second dancer is someone else: no autofill with the first one's details.
  await page.locator('#add-dancer-btn').click();
  await expect(page.locator('.dancer-block').nth(1).locator('.dancer-first-name')).toHaveAttribute('autocomplete', 'off');
  await page.locator('.dancer-block').nth(1).locator('.remove-dancer-btn').click();

  await selectSeries(page, series.key);
  await first.locator('.dancer-last-name').fill(RUN_ID);
  await submitRegistration(page);
  const firstName = first.locator('.dancer-first-name');
  await expect(firstName).toHaveAttribute('aria-invalid', 'true');
  await expect(firstName).toHaveAttribute('aria-describedby', 'dancers-error');
  await expect(first.locator('.dancer-last-name')).not.toHaveAttribute('aria-invalid', /.*/);
  await expect(first.locator('.dancer-phone')).toHaveAttribute('aria-invalid', 'true');
  await firstName.fill('ZZZFixed');
  await expect(firstName).not.toHaveAttribute('aria-invalid', /.*/);
  await first.locator('.dancer-email').fill('zzz@example.com');
  await expect(first.locator('.dancer-phone')).not.toHaveAttribute('aria-invalid', /.*/);
});

import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// The guidelines are one shared setting: these tests set their own and put
// the real ones back afterwards.
let originalGuidelines: string | null = null;
let paid: Seeded;
let free: Seeded;

const GUIDELINES = `<div>ZZZ intro ${RUN_ID}</div><h3>ZZZ Consent</h3><div>Always ask first.</div><h3>ZZZ Hygiene</h3><ul><li>Fresh clothes</li></ul>`;
const setGuidelines = (body: string) => db.from('community_guidelines').upsert({ id: true, body, updated_at: new Date().toISOString() });

test.beforeAll(async () => {
  const { data } = await db.from('community_guidelines').select('body').eq('id', true).maybeSingle();
  originalGuidelines = data?.body ?? '';
  paid = await seedEvent({ name: 'Gala', type: 'event', priceWhole: 15, capacity: 40 });
  free = await seedEvent({ name: 'Free Social', type: 'event', priceWhole: null, dayOffset: 1 });
});

test.afterAll(async () => {
  await setGuidelines(originalGuidelines ?? '');
});

const eventFields = (s: Seeded, extra: Record<string, string> = {}) => ({
  registration_type: 'events',
  class: s.title,
  payment_method: 'cash',
  class_selections: JSON.stringify([{ key: s.key, title: s.title, label: '', mode: null }]),
  dancers: JSON.stringify([{ firstName: 'ZZZGuest', lastName: RUN_ID, role: '', phone: '6085550123', email: '' }]),
  ...extra,
});

test.describe.serial('with community guidelines', () => {
  test.beforeAll(async () => {
    await setGuidelines(GUIDELINES);
  });

  test('registrants must read and agree to the guidelines, which the confirmation lists FAQ-style', async ({ page }) => {
    await page.goto(`/register/events?series=${paid.key}`);
    await selectSeries(page, paid.key);
    await expect(page.locator('body')).toContainText('We are dedicated to creating a safe, inclusive, and creative space');
    await expect(page.locator('body')).toContainText(`ZZZ intro ${RUN_ID}`);
    // The guidelines come before the subtotal and payment step.
    const guidelinesFirst = await page.evaluate(() => {
      const box = document.getElementById('agree-guidelines')!;
      const subtotal = document.getElementById('subtotal-row')!;
      return Boolean(box.compareDocumentPosition(subtotal) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(guidelinesFirst).toBe(true);
    // An event's card has no "· Event" label (the page only lists events) and no stray "·" before its location.
    await expect(page.locator(`.series-item[data-key="${paid.key}"] .series-header`)).not.toContainText('·');
    // Events never ask for a role.
    await expect(page.locator('.dancer-role-btn')).toHaveCount(0);

    const email = `zzz-e2e-${RUN_ID.toLowerCase()}-guest@example.com`;
    await fillDancer(page, 0, { first: 'EventGuest', email });
    await payCash(page);
    await submitRegistration(page);
    await expect(page.locator('#guidelines-error')).toBeVisible();
    await expect(page).toHaveURL(/\/register\/events/);

    await page.locator('#agree-guidelines').check();
    await expect(page.locator('#guidelines-error')).toBeHidden();
    await submitRegistration(page);
    await page.waitForURL(/\/register\/confirmation\?id=/);

    const body = page.locator('body');
    await expect(body).toContainText('See you there!');
    await expect(body).toContainText('Our Community Guidelines');
    await expect(body).not.toContainText('A Few Reminders');
    await expect(page.locator('details summary')).toHaveText([/ZZZ Consent/, /ZZZ Hygiene/]);
    // An attendee with no role has no stray separator in front of their phone.
    const contactLine = page.locator('span', { hasText: 'Attendee 1:' }).locator('xpath=following-sibling::span[1]');
    await expect(contactLine).toHaveText(email);

    // Printed on white paper, the text is dark (it was once the site's cream,
    // all but invisible) and the cookie banner stays off the page.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('heading', { name: 'Your Registration is Confirmed!' })).toHaveCSS('color', 'rgb(26, 18, 16)');
    await expect(page.locator('#cookie-consent')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    const { data } = await db.from('intake_submissions').select('guidelines_agreed_at, created_at').eq('id', confirmationId(page.url())!).single();
    expect(data!.guidelines_agreed_at).not.toBeNull();
    // "Submitted …" is in the site's time zone, not the server's (UTC on Netlify, 5 hours ahead).
    const submitted = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(data!.created_at));
    await expect(body).toContainText(`Submitted ${submitted}`);

    const sent = emailsAbout('ZZZEventGuest').filter((e) => e.html.includes(RUN_ID));
    expect(sent.length).toBeGreaterThan(0);
    for (const e of sent) {
      expect(e.subject).toContain('Event Registration is Confirmed');
      expect(e.html).toContain('Our Community Guidelines');
      expect(e.html).toContain('ZZZ Consent');
      expect(e.html).not.toContain('A Few Reminders');
    }
  });

  test('the server refuses an event registration without the agreement', async ({ request }) => {
    const res = await postForm(request, '/api/submit-intake', eventFields(paid));
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('community guidelines');
  });

  test('class registrations never show the guidelines', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('#agree-guidelines')).toHaveCount(0);
  });
});

test.describe.serial('without community guidelines', () => {
  test.beforeAll(async () => {
    await setGuidelines('');
  });

  test('the section is left out and nothing needs agreeing to', async ({ page, request }) => {
    await page.goto(`/register/events?series=${paid.key}`);
    await expect(page.locator('#agree-guidelines')).toHaveCount(0);
    const res = await postForm(request, '/api/submit-intake', eventFields(paid, { dancers: JSON.stringify([{ firstName: 'ZZZNoRules', lastName: RUN_ID, role: '', phone: '6085550124', email: '' }]) }));
    expect(res.status()).toBe(303);
  });

  test('a free event skips the subtotal and payment step', async ({ page }) => {
    await page.goto('/register/events');
    // Shown before anything is picked, like on the classes form.
    await expect(page.locator('#subtotal-row')).toBeVisible();
    await expect(page.locator('#payment-section')).toBeVisible();
    await selectSeries(page, free.key);
    await expect(page.locator('#subtotal-row')).toBeHidden();
    await expect(page.locator('#payment-section')).toBeHidden();
    await fillDancer(page, 0, { first: 'FreeGuest' });
    await submitRegistration(page);
    await page.waitForURL(/\/register\/confirmation\?id=/);
    await expect(page.locator('body')).not.toContainText('You agreed to pay');
  });

  test('a paid event needs a payment method', async ({ request }) => {
    const res = await postForm(request, '/api/submit-intake', eventFields(paid, { payment_method: '' }));
    expect(res.status()).toBe(400);
  });
});

import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, sweepTestData, testTitle, track, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

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

test.describe('at the door', () => {
  // Let go of the Event Registration tab's edit lock the dashboard test takes (even if it fails),
  // so the real dashboard isn't locked out for 10 minutes.
  let takenLock: string | null = null;
  test.afterAll(async () => {
    if (takenLock) await db.from('edit_locks').delete().eq('resource', 'analytics-event-registrations').eq('locked_by', takenLock);
  });

  // Events happening now (not far in the future like the others), with fake
  // Google ids so no calendar sync pushes them anywhere.
  const insertNowEvent = async (name: string, startMinutes: number, endMinutes: number) => {
    const { data, error } = await db
      .from('events')
      .insert({
        title: testTitle(name),
        event_type: 'event',
        visibility: 'test',
        color: 'green',
        start_time: new Date(Date.now() + startMinutes * 60000).toISOString(),
        end_time: new Date(Date.now() + endMinutes * 60000).toISOString(),
        google_event_id: `zzz-e2e-${RUN_ID}-${name.replace(/\W/g, '')}`,
        price_whole_series: 10,
      })
      .select('id, title')
      .single();
    if (error || !data) throw new Error(error?.message);
    return track({ title: data.title as string, key: data.id as string, ids: [data.id as string] });
  };

  test('an event takes registrations until 30 minutes after it ends, then stops', async ({ page, request }) => {
    const justEnded = await insertNowEvent('Door Social', -180, -10);
    const longOver = await insertNowEvent('Over Social', -240, -45);

    await page.goto('/register/events');
    await expect(page.locator(`.series-item[data-key="${justEnded.key}"]`)).toBeVisible();
    await expect(page.locator(`.series-item[data-key="${longOver.key}"]`)).toHaveCount(0);

    const fields = (s: Seeded, phone: string) =>
      eventFields(s, { agree_guidelines: 'on', dancers: JSON.stringify([{ firstName: 'ZZZDoor', lastName: RUN_ID, role: '', phone, email: '' }]) });
    expect((await postForm(request, '/api/submit-intake', fields(justEnded, '6085550401'))).status()).toBe(303);
    const refused = await postForm(request, '/api/submit-intake', fields(longOver, '6085550402'));
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain("isn't open for registration");
  });

  test('an admin adds an event registration from the dashboard', async ({ page, adminPage }) => {
    void adminPage;
    const door = await insertNowEvent('Dashboard Door', -60, 60);
    await page.goto('/admin/analytics?tab=event-registration');
    await page.locator('.tab-btn[data-tab="event-registration"]').click();
    await page.locator('#event-registrations-lock-btn').click();
    await expect(page.locator('#add-event-registration-btn')).toBeVisible();
    const { data: lock } = await db.from('edit_locks').select('locked_by').eq('resource', 'analytics-event-registrations').maybeSingle();
    takenLock = lock?.locked_by ?? null;
    await page.locator('#add-event-registration-btn').click();
    const row = page.locator('tr', { has: page.locator('.save-event-registration-btn[data-mode="add"]') });
    await row.locator('.first-name').fill('ZZZWalkIn');
    await row.locator('.last-name').fill(RUN_ID);
    await row.locator('.phone').fill('6085550403');
    await row.locator(`.event-registration-checkbox[data-key="${door.key}"]`).check();
    await row.locator('.payment-select-cell select').selectOption('cash');
    await row.locator('.paid').check();
    await row.locator('.save-event-registration-btn').click();
    await expect(page.locator('#event-registrations-body tr', { hasText: 'ZZZWalkIn' }).first()).toContainText(door.title);

    const { data } = await db.from('intake_submissions').select('id, registration_type, paid, dancers').eq('first_name', 'ZZZWalkIn').eq('last_name', RUN_ID).single();
    expect(data).toMatchObject({ registration_type: 'events', paid: true });
    const { data: regs } = await db.from('class_registrations').select('class_title, price').eq('submission_id', data!.id);
    expect(regs).toEqual([{ class_title: door.title, price: 10 }]);
  });
});

test('the payment and contact wording reads properly for an event, not just a class', async ({ page }) => {
  await page.goto(`/register/events?series=${paid.key}`);
  await selectSeries(page, paid.key);
  // Raw textContent, not toContainText, which would hide a doubled space.
  for (const method of ['cash', 'venmo']) {
    expect(await page.locator(`.payment-item[data-value="${method}"] .payment-details`).textContent()).toContain('before the event begins.');
  }
  await expect(page.locator('.dancer-block').first()).toBeVisible();
  expect(await page.locator('.dancer-block').first().textContent()).toContain('reach you about changes,');
});

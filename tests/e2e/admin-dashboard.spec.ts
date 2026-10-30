import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { bearer } from './support/admin';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

let klass: Seeded;
let event: Seeded;
let guestSubmission: string;

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Dashboard Class', occurrences: 2 });
  await seedSignup(klass, [
    { first: 'DashLead', role: 'leader' },
    { first: 'DashFollow', role: 'follower' },
  ]);
  event = await seedEvent({ name: 'Dashboard Event', type: 'event', dayOffset: 1 });
  guestSubmission = await seedSignup(event, [{ first: 'DashGuest' }], 'events');
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

// On a phone the tables scrolled sideways, so matching an action to its
// dancer meant reading across a row wider than the screen. Below lg each row
// is compact (paid dot, name, a line of chosen fields) and opens on a tap.
for (const [width, compact] of [
  [390, true],
  [820, true],
  [1280, false],
] as const) {
  test(`the sign-ups ${compact ? 'show as compact rows' : 'stay a table'} at ${width}px wide`, async ({ page, adminPage }) => {
    void adminPage;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/analytics');
    const row = page.locator('#signups-body tr', { hasText: 'ZZZDashLead' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    expect(await row.evaluate((tr) => getComputedStyle(tr).display)).toBe(compact ? 'flex' : 'table-row');
    const picker = page.locator('#tab-panel-signups details', { hasText: 'Fields on each row' });
    if (!compact) {
      await expect(picker).toBeHidden();
      return;
    }
    // It fits on screen, with nothing to scroll sideways to.
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Shut: two short lines, the name (with an unpaid dot) over the chosen fields.
    expect(box.height).toBeLessThan(80);
    await expect(row).toHaveAttribute('data-card-paid', 'no');
    await expect(row.locator('td[data-label="Class"]')).toBeVisible();
    await expect(row.locator('td[data-label="Contact Info"]')).toBeHidden();
    // A long class name is cut short in the middle, keeping the role at the end.
    await row.locator('.class-name').evaluate((el) => (el.textContent += ' with a very long name'.repeat(8)));
    const roleBox = (await row.locator('.class-role').boundingBox())!;
    await expect(row.locator('.class-role')).toHaveText(' - Leader');
    expect(roleBox.x + roleBox.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await row.locator('.class-name').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // The type of registration sits on the name's line, the class below it.
    const nameBox = (await row.locator('td').first().boundingBox())!;
    const typeBox = (await row.locator('td[data-label="Type of Registration"]').boundingBox())!;
    expect(Math.abs(typeBox.y + typeBox.height / 2 - (nameBox.y + nameBox.height / 2))).toBeLessThan(4);
    expect((await row.locator('td[data-label="Class"]').boundingBox())!.y).toBeGreaterThan(nameBox.y + nameBox.height - 1);
    await expect(row.locator('td[data-label="Payment"]')).toBeHidden();

    // A tap opens every column, labelled.
    await row.locator('td').first().click();
    await expect(row.locator('td[data-label="Contact Info"]')).toBeVisible();
    expect(await row.locator('td[data-label="Class"]').evaluate((td) => getComputedStyle(td, '::before').content)).toBe('"Class"');
    await row.locator('td').first().click();
    await expect(row.locator('td[data-label="Contact Info"]')).toBeHidden();

    // The picker (shut until asked for) adds a field to every row, and it's remembered.
    await expect(picker.getByRole('button', { name: 'Payment' })).toBeHidden();
    await picker.locator('summary').click();
    await picker.getByRole('button', { name: 'Payment' }).click();
    await expect(row.locator('td[data-label="Payment"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('#signups-body tr', { hasText: 'ZZZDashLead' }).locator('td[data-label="Payment"]')).toBeVisible({ timeout: 30_000 });
  });
}

test.describe('with the Event Registration lock taken', () => {
  // Let go of the tab's edit lock (even if the test fails), so the real
  // dashboard isn't locked out for 10 minutes.
  let takenLock: string | null = null;
  test.afterAll(async () => {
    if (takenLock) await db.from('edit_locks').delete().eq('resource', 'analytics-event-registrations').eq('locked_by', takenLock);
  });

  test("on a phone a dancer's row keeps their name, Paid box, payment and action buttons together, and their second event joins it", async ({ page, adminPage }) => {
    void adminPage;
    const second = await seedEvent({ name: 'Dashboard Event Two', type: 'event', dayOffset: 2 });
    const { error } = await db.from('class_registrations').insert({
      submission_id: guestSubmission,
      dancer_index: 0,
      first_name: 'ZZZDashGuest',
      last_name: RUN_ID,
      phone: '5550100',
      class_title: second.title,
      class_label: second.title,
      series_key: second.key,
      price: 10,
    });
    expect(error).toBeNull();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/admin/analytics?tab=event-registration');
    await page.locator('.tab-btn[data-tab="event-registration"]').click();
    await page.locator('#event-registrations-lock-btn').click();
    await expect(page.locator('#add-event-registration-btn')).toBeVisible();
    const { data: lock } = await db.from('edit_locks').select('locked_by').eq('resource', 'analytics-event-registrations').maybeSingle();
    takenLock = lock?.locked_by ?? null;

    const card = page.locator('#event-registrations-body tr', { hasText: 'ZZZDashGuest' });
    const edit = card.locator('.edit-event-registration-btn');
    await expect(edit).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const editBox = (await edit.boundingBox())!;
    const nameBox = (await card.locator('td').first().boundingBox())!;
    // Inside the row, at the end of its second line (the event's).
    const eventBox = (await card.locator('td[data-label="Event"]').boundingBox())!;
    expect(editBox.x + editBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(editBox.x).toBeGreaterThan(eventBox.x + eventBox.width - 1);
    expect(Math.abs(editBox.y + editBox.height / 2 - (eventBox.y + eventBox.height / 2))).toBeLessThan(5);
    // The payment follows the name on its line, with the Paid switch at the line's far right; the event is below.
    const midY = (b: { y: number; height: number }) => b.y + b.height / 2;
    const paidBox = (await card.locator('.event-paid-checkbox').boundingBox())!;
    const paymentBox = (await card.locator('td[data-label="Payment"]').boundingBox())!;
    expect(Math.abs(midY(paidBox) - midY(nameBox))).toBeLessThan(5);
    expect(Math.abs(midY(paymentBox) - midY(nameBox))).toBeLessThan(5);
    expect(paymentBox.x).toBeGreaterThan(nameBox.x + nameBox.width - 1);
    expect(paidBox.x).toBeGreaterThanOrEqual(paymentBox.x + paymentBox.width);
    expect(cardBox.x + cardBox.width - (paidBox.x + paidBox.width)).toBeLessThan(20);
    expect((await card.locator('td[data-label="Event"]').boundingBox())!.y).toBeGreaterThan(nameBox.y + nameBox.height - 1);
    // It's a switch (✗ / ✓) that marks the registration paid straight from the row.
    const paidSwitch = card.getByRole('switch', { name: 'Paid' });
    await expect(paidSwitch).not.toBeChecked();
    await page.evaluate(() => document.getElementById('cookie-consent')?.remove());
    await paidSwitch.click();
    await expect(paidSwitch).toBeChecked();
    await expect(paidSwitch).toBeEnabled();
    await expect.poll(async () => (await db.from('intake_submissions').select('paid').eq('id', guestSubmission).single()).data?.paid).toBe(true);
    // The second event's row carries on straight below, as part of the same card.
    const more = card.locator('xpath=following-sibling::tr[1]');
    await expect(more).toHaveAttribute('data-card-continued', '');
    await expect(more).toContainText(second.title);
    const cardNow = (await card.boundingBox())!;
    expect(Math.abs((await more.boundingBox())!.y - (cardNow.y + cardNow.height))).toBeLessThan(1);

    // Editing keeps Save on screen too.
    await edit.click();
    const save = page.locator('#event-registrations-body .save-event-registration-btn');
    await expect(save).toBeVisible();
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test('the check-in QR tool makes a QR for a class', async ({ request, admin }) => {
  const res = await request.post('/api/admin/generate-checkin-qr', { headers: bearer(admin), data: { eventIds: [klass.ids[0]] } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(JSON.stringify(body)).toContain('data:image');
  expect(JSON.stringify(body)).toContain(`/check-in/${klass.ids[0]}`);
});

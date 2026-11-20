import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData, type Seeded } from './support/db';

// Sorted by Paid, switching a dancer's Paid sent their row straight to its new
// place (Event Registration at once, Sign-Ups as soon as the lock was let go or
// anything was saved). Rows now stay where the admin is looking until they sort
// or filter again (src/lib/stableOrder.ts).
test.afterAll(sweepTestData);

let klass: Seeded;
let event: Seeded;

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Stable Order Class' });
  event = await seedEvent({ name: 'Stable Order Event', type: 'event', dayOffset: 1 });
  // One sign-up each, so each has its own Paid.
  for (const first of ['StableAda', 'StableBea', 'StableCal']) {
    await seedSignup(klass, [{ first }]);
    await seedSignup(event, [{ first: `${first}Ev` }], 'events');
  }
});

// Let go of any lock taken (even if a test fails), so the real dashboard isn't locked out for 10 minutes.
const taken: { resource: string; locked_by: string }[] = [];
test.afterAll(async () => {
  for (const t of taken) await db.from('edit_locks').delete().eq('resource', t.resource).eq('locked_by', t.locked_by);
});

async function takeLock(page: Page, button: string, resource: string) {
  await page.locator(button).click();
  await expect(page.locator(button)).toHaveText(/Release/i, { timeout: 30_000 });
  const { data } = await db.from('edit_locks').select('resource, locked_by').ilike('resource', `%${resource}%`).maybeSingle();
  if (data) taken.push(data);
}

// The dancers shown (first names) and whether each is paid, top to bottom.
const shown = (page: Page, body: string, paidBox: string) =>
  page.locator(`${body} tr:not([data-card-continued])`).evaluateAll(
    (rows, box) => rows.map((tr) => [tr.querySelector('td')?.textContent?.trim() ?? '', (tr.querySelector(box) as HTMLInputElement | null)?.checked ?? false] as const),
    paidBox
  );

for (const t of [
  { name: 'Sign-Ups', width: 1280, tab: 'signups', body: '#signups-body', box: '.paid-checkbox', lock: '#signups-lock-btn', resource: 'signups', table: 'signups' },
  // On a phone (the compact rows use the same drawing).
  { name: 'Event Registration', width: 390, tab: 'event-registration', body: '#event-registrations-body', box: '.event-paid-checkbox', lock: '#event-registrations-lock-btn', resource: 'event-registrations', table: 'event-registrations' },
] as const) {
  test(`${t.name} sorted by Paid: a switched row stays put until Paid is sorted again`, async ({ page, adminPage }) => {
    void adminPage;
    await page.setViewportSize({ width: t.width, height: 900 });
    await page.goto(`/admin/analytics?tab=${t.tab}`);
    await page.locator(`.tab-btn[data-tab="${t.tab}"]`).click();
    await expect(page.locator(`${t.body} tr`, { hasText: 'ZZZStableAda' })).toBeVisible({ timeout: 30_000 });
    // Just ours: the server lists real sign-ups too.
    if (t.tab === 'signups') await page.locator('#signups-class-filters select').first().selectOption(klass.key);
    else await page.locator('#event-registrations-event-filter').selectOption(event.key);
    await expect.poll(async () => (await shown(page, t.body, t.box)).length).toBe(3);

    const paidHeader = page.locator(`th[data-table="${t.table}"][data-column="paid"]`);
    await paidHeader.click(); // Paid ↑: unpaid first
    await expect(paidHeader).toHaveText(/↑/);
    await takeLock(page, t.lock, t.resource);
    const before = await shown(page, t.body, t.box);
    expect(before.map(([, paid]) => paid)).toEqual([false, false, false]);
    const [first] = before[0];

    // The top row is marked paid: sorted, it belongs at the bottom, but it stays on top.
    const row = page.locator(`${t.body} tr`, { hasText: first });
    await row.getByRole('switch', { name: 'Paid' }).click();
    await expect(row.getByRole('switch', { name: 'Paid' })).toBeChecked();
    await expect(row.getByRole('switch', { name: 'Paid' })).toBeEnabled();
    const after = [[first, true], ...before.slice(1)];
    await expect.poll(() => shown(page, t.body, t.box)).toEqual(after);

    if (t.tab === 'signups') {
      // Saving another row reloads every sign-up: still in place.
      await page.locator(`${t.body} tr`, { hasText: before[1][0] }).locator('.edit-signup-btn').click();
      await page.locator(`${t.body} .save-signup-btn`).click();
      await expect(page.locator(`${t.body} .save-signup-btn`)).toHaveCount(0);
      await expect.poll(() => shown(page, t.body, t.box)).toEqual(after);
    }
    // Letting go of the lock draws the table again: still in place.
    await page.locator(t.lock).click();
    await expect(page.locator(t.lock)).toHaveText(/Try Lock/i);
    await expect.poll(() => shown(page, t.body, t.box)).toEqual(after);
    await page.screenshot({ path: test.info().outputPath(`stable-order-${t.tab}.png`) });

    // Sorting Paid again (↓, then ↑) puts it where it now belongs.
    await paidHeader.click();
    await expect.poll(async () => (await shown(page, t.body, t.box))[0]).toEqual([first, true]);
    await paidHeader.click();
    await expect.poll(async () => (await shown(page, t.body, t.box))[2]).toEqual([first, true]);
  });
}

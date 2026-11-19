import { test, expect } from './support/fixtures';
import { seedEvent, sweepTestData, type Seeded } from './support/db';
import { authStorageKey } from './support/admin';
import { RUN_ID, TEST_PREFIX } from './support/env';
import { fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// Roadmap 9: the first dancer's name, email, phone and role are kept on the
// visitor's device after a sign-up the server accepted (src/scripts/rememberDancer.ts),
// and fill the next sign-up. Every test gets a fresh browser context, so storage starts clean.
test.afterAll(sweepTestData);

let classA: Seeded;
let classB: Seeded;
let eventC: Seeded;

test.beforeAll(async () => {
  classA = await seedEvent({ name: 'Remember A', priceWhole: 20, dayOffset: 2 });
  classB = await seedEvent({ name: 'Remember B', priceWhole: 20, dayOffset: 3 });
  eventC = await seedEvent({ name: 'Remember Event', type: 'event', priceWhole: 10, dayOffset: 4 });
});

const EMAIL = `zzz-e2e-${RUN_ID.toLowerCase()}-remember@example.com`;
const NOTE = '.remembered-note';
const first = (page: import('@playwright/test').Page) => page.locator('.dancer-block').first().locator('.dancer-first-name');
const stored = (page: import('@playwright/test').Page) => page.evaluate(() => localStorage.getItem('dwb.dancer.v1'));

// A completed sign-up on /register, leaving the device with a remembered dancer.
async function signUp(page: import('@playwright/test').Page, series: Seeded) {
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Remember', role: 'follower', phone: '6085550177', email: EMAIL });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
}

test('a fresh visitor sees empty fields and no remembered line', async ({ page }) => {
  await page.goto(`/register?series=${classA.key}`);
  const block = page.locator('.dancer-block').first();
  await expect(first(page)).toHaveValue('');
  await expect(block.locator('.dancer-last-name')).toHaveValue('');
  await expect(block.locator('.dancer-phone')).toHaveValue('');
  await expect(block.locator('.dancer-email')).toHaveValue('');
  await expect(block.locator('.dancer-role-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(NOTE)).toHaveCount(0);
  await expect(page.getByText('Filled in from your last sign-up')).toHaveCount(0);
  expect(await stored(page)).toBeNull();
});

test('after a successful sign-up the next one starts filled in, and submits with those values', async ({ page }) => {
  await signUp(page, classA);
  // Only the first dancer's contact details are kept, nothing about the class or payment.
  const saved = JSON.parse((await stored(page))!);
  expect(Object.keys(saved).sort()).toEqual(['email', 'firstName', 'lastName', 'phone', 'role', 'savedAt']);
  expect(saved).toMatchObject({ firstName: `${TEST_PREFIX}Remember`, lastName: RUN_ID, phone: '6085550177', email: EMAIL, role: 'follower' });

  await page.goto(`/register?series=${classB.key}`);
  const block = page.locator('.dancer-block').first();
  await expect(first(page)).toHaveValue(`${TEST_PREFIX}Remember`);
  await expect(block.locator('.dancer-last-name')).toHaveValue(RUN_ID);
  await expect(block.locator('.dancer-phone')).toHaveValue('6085550177');
  await expect(block.locator('.dancer-email')).toHaveValue(EMAIL);
  await expect(block.locator('.dancer-role-btn[data-role="follower"]')).toHaveAttribute('aria-pressed', 'true');
  const note = page.locator(NOTE);
  await expect(note).toHaveText('Filled in from your last sign-up on this device. Clear');
  await expect(note).toHaveAttribute('role', 'status');
  // The line sits right under the first dancer's phone and email.
  const gap = await page.evaluate(() => {
    const grid = document.querySelector('.dancer-block .dancer-phone')!.closest('.grid')!;
    const note = document.querySelector('.remembered-note')!;
    return note.getBoundingClientRect().top - grid.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(24);

  // Nothing but the dancer is remembered: the class and payment are not.
  await expect(page.locator('#payment-method-value, input[name="payment_method"]').first()).toHaveValue('');

  await selectSeries(page, classB.key);
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  await expect(page.locator('body')).toContainText(`${TEST_PREFIX}Remember ${RUN_ID}`);
  await expect(page.locator('body')).toContainText('follower');
  await expect(page.locator('body')).toContainText('6085550177');
});

test('an event sign-up is remembered too, without a role', async ({ page }) => {
  await page.goto(`/register/events?series=${eventC.key}`);
  await selectSeries(page, eventC.key);
  await fillDancer(page, 0, { first: 'Remember', phone: '6085550177', email: EMAIL });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  expect(JSON.parse((await stored(page))!)).toMatchObject({ phone: '6085550177', email: EMAIL, role: '' });
  await page.goto(`/register/events?series=${eventC.key}`);
  await expect(first(page)).toHaveValue(`${TEST_PREFIX}Remember`);
  await expect(page.locator(NOTE)).toBeVisible();
});

test('Clear empties the fields, removes the line, focuses the name and a reload stays empty', async ({ page }) => {
  await signUp(page, classA);
  await page.goto(`/register?series=${classB.key}`);
  await expect(page.locator(NOTE)).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  const block = page.locator('.dancer-block').first();
  await expect(first(page)).toHaveValue('');
  await expect(block.locator('.dancer-last-name')).toHaveValue('');
  await expect(block.locator('.dancer-phone')).toHaveValue('');
  await expect(block.locator('.dancer-email')).toHaveValue('');
  await expect(block.locator('.dancer-role-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByText('Filled in from your last sign-up')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await expect(first(page)).toBeFocused();
  expect(await stored(page)).toBeNull();
  await page.reload();
  await expect(first(page)).toHaveValue('');
  await expect(page.locator(NOTE)).toHaveCount(0);
});

test('a failed submit saves nothing', async ({ page }) => {
  await page.route('**/api/submit-intake', (route) => route.fulfill({ status: 500, contentType: 'text/html', body: 'ZZZ server said no' }));
  await page.goto(`/register?series=${classA.key}`);
  await selectSeries(page, classA.key);
  await fillDancer(page, 0, { first: 'Remember', role: 'leader', phone: '6085550177', email: EMAIL });
  await payCash(page);
  await submitRegistration(page);
  await expect(page.locator('body')).toContainText('ZZZ server said no');
  expect(await stored(page)).toBeNull();
  // Going back to the form: still nothing remembered, nothing left parked.
  await page.unroute('**/api/submit-intake');
  await page.goto(`/register?series=${classA.key}`);
  await expect(first(page)).toHaveValue('');
  await expect(page.locator(NOTE)).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('dwb.dancer.pending.v1'))).toBeNull();
});

test('a corrupt or wrong-typed store leaves the form as it is', async ({ page }) => {
  await page.goto(`/register?series=${classA.key}`);
  await page.evaluate(() => localStorage.setItem('dwb.dancer.v1', '{broken'));
  await page.reload();
  await expect(first(page)).toHaveValue('');
  await expect(page.locator(NOTE)).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('dwb.dancer.v1', JSON.stringify({ firstName: 7, lastName: ['x'], email: null, phone: {}, role: 'boss' })));
  await page.reload();
  await expect(first(page)).toHaveValue('');
  await expect(page.locator(NOTE)).toHaveCount(0);
});

test('details the page already holds are not overwritten', async ({ page }) => {
  await page.goto(`/register?series=${classA.key}`);
  await page.evaluate(() => localStorage.setItem('dwb.dancer.v1', JSON.stringify({ firstName: 'ZZZOld', lastName: 'Saved', email: 'old@example.com', phone: '', role: '', savedAt: 1 })));
  // A field already filled when the form's script builds the block (as after the browser's Back) is left alone.
  await page.addInitScript(() => {
    const append = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
      const added = append.call(this, node) as T;
      if ((node as unknown as Element).classList?.contains('dancer-block')) {
        (node as unknown as Element).querySelector<HTMLInputElement>('.dancer-first-name')!.value = 'ZZZTyped';
      }
      return added;
    };
  });
  await page.reload();
  await expect(first(page)).toHaveValue('ZZZTyped');
  await expect(page.locator('.dancer-block').first().locator('.dancer-email')).toHaveValue('');
  await expect(page.locator(NOTE)).toHaveCount(0);
});

// An instructor signs several dancers up on their own phone: with a stored
// session present (a placeholder, never a real token) the last dancer must not
// fill the next form, and the sign-up leaves nothing saved.
test('a device that might be an admin\'s fills nothing, saves nothing and drops a saved dancer', async ({ page, context }) => {
  // Written on every load: the header's sign-in check removes a dead session.
  await context.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ access_token: 'zzz-not-a-real-token', refresh_token: 'zzz-not-a-real-token', expires_at: 1 })), authStorageKey());
  await page.goto(`/register?series=${classA.key}`);
  await page.evaluate(() => localStorage.setItem('dwb.dancer.v1', JSON.stringify({ firstName: 'ZZZOld', lastName: 'Saved', email: 'old@example.com', phone: '6085550111', role: 'leader', savedAt: 1 })));
  await page.reload();
  const block = page.locator('.dancer-block').first();
  await expect(block).toBeVisible();
  await expect(first(page)).toHaveValue('');
  await expect(block.locator('.dancer-email')).toHaveValue('');
  await expect(block.locator('.dancer-role-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(NOTE)).toHaveCount(0);
  expect(await stored(page)).toBeNull();

  await selectSeries(page, classA.key);
  await fillDancer(page, 0, { first: 'Remember', role: 'follower', phone: '6085550177', email: EMAIL });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  await expect(page.locator('body')).toContainText(`${TEST_PREFIX}Remember ${RUN_ID}`);
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('dwb.dancer.pending.v1'))).toBeNull();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const remember = { firstName: `${TEST_PREFIX}Remember`, lastName: RUN_ID, email: EMAIL, phone: '6085550177', role: 'follower', savedAt: 1 };

  test('filling the fields does not move the first dancer block, and Clear has a 44px tap area', async ({ page }) => {
    await page.addInitScript(() => {
      // The block's top at the moment the fill fires its first input event.
      (window as unknown as { tops: number[] }).tops = [];
      document.addEventListener(
        'input',
        () => {
          const b = document.querySelector('.dancer-block');
          if (b) (window as unknown as { tops: number[] }).tops.push(Math.round(b.getBoundingClientRect().top + scrollY));
        },
        true
      );
    });
    const top = () => page.evaluate(() => Math.round(document.querySelector('.dancer-block')!.getBoundingClientRect().top + scrollY));
    await page.goto('/register');
    const emptyTop = await top();
    await page.evaluate((r) => localStorage.setItem('dwb.dancer.v1', JSON.stringify(r)), remember);
    await page.reload();
    await expect(page.locator(NOTE)).toBeVisible();
    await expect(first(page)).toHaveValue(remember.firstName);
    const tops = await page.evaluate(() => (window as unknown as { tops: number[] }).tops);
    expect(tops.length).toBeGreaterThan(0);
    const filledTop = await top();
    expect(filledTop).toBe(emptyTop);
    for (const t of tops) expect(t).toBe(emptyTop);

    const tap = await page.evaluate(() => {
      const btn = document.querySelector('.remembered-note button')!;
      return parseFloat(getComputedStyle(btn, '::after').height);
    });
    expect(tap).toBeGreaterThanOrEqual(44);

    await page.getByRole('button', { name: 'Clear' }).click();
    expect(await top()).toBe(emptyTop);
  });
});

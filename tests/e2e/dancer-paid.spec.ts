import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData, type Seeded } from './support/db';

// Marking one dancer of a group sign-up paid marked every dancer on it (one
// Paid per sign-up). Each dancer has their own now (dancers[i].paid,
// src/lib/dancerPaid.ts); a sign-up saved before that reads as it did until
// a switch changes. Each test deletes the class it seeded (support/fixtures.ts).
test.afterAll(sweepTestData);

// Let go of any lock taken (even if a test fails), so the real dashboard isn't locked out for 10 minutes.
const taken: { resource: string; locked_by: string }[] = [];
test.afterAll(async () => {
  for (const t of taken) await db.from('edit_locks').delete().eq('resource', t.resource).eq('locked_by', t.locked_by);
});

const TABS = {
  signups: { name: 'Sign-Ups', body: '#signups-body', box: '.paid-checkbox', lock: '#signups-lock-btn', resource: 'analytics-signups', type: 'group' },
  events: { name: 'Event Registration', body: '#event-registrations-body', box: '.event-paid-checkbox', lock: '#event-registrations-lock-btn', resource: 'analytics-event-registrations', type: 'events' },
} as const;
type Tab = (typeof TABS)[keyof typeof TABS];

// A two-dancer sign-up already marked paid as a whole, as saved before
// dancers had their own Paid: no flag on either dancer.
async function seedPaidPair(klass: Seeded, tab: Tab, first: string, second: string): Promise<string> {
  const id = await seedSignup(klass, [{ first }, { first: second }], tab.type);
  await db.from('intake_submissions').update({ paid: true }).eq('id', id);
  return id;
}

async function openTab(page: Page, tab: Tab, klass: Seeded) {
  const key = tab === TABS.signups ? 'signups' : 'event-registration';
  await page.goto(`/admin/analytics?tab=${key}`);
  await page.locator(`.tab-btn[data-tab="${key}"]`).click();
  // Just ours: the server lists real sign-ups too.
  if (tab === TABS.signups) await page.locator('#signups-class-filters select').first().selectOption(klass.key);
  else await page.locator('#event-registrations-event-filter').selectOption(klass.key);
  await expect(page.locator(`${tab.body} ${tab.box}`)).toHaveCount(2, { timeout: 30_000 });
}

async function takeLock(page: Page, tab: Tab) {
  await page.locator(tab.lock).click();
  await expect(page.locator(tab.lock)).toHaveText(/Release/i, { timeout: 30_000 });
  const { data } = await db.from('edit_locks').select('resource, locked_by').eq('resource', tab.resource).maybeSingle();
  if (data) taken.push(data);
}

async function releaseLock(page: Page, tab: Tab) {
  await page.locator(tab.lock).click();
  await expect(page.locator(tab.lock)).toHaveText(/Try Lock/i);
}

const paidSwitch = (page: Page, tab: Tab, name: string) => page.locator(`${tab.body} tr`, { hasText: name }).getByRole('switch', { name: 'Paid' });

// [dancer 1's flag, dancer 2's flag, the sign-up's own Paid] as saved.
async function saved(id: string) {
  const { data } = await db.from('intake_submissions').select('paid, dancers').eq('id', id).single();
  const dancers = (data?.dancers ?? []) as { paid?: boolean }[];
  return [dancers[0]?.paid, dancers[1]?.paid, data?.paid];
}

for (const tab of Object.values(TABS)) {
  test(`${tab.name}: each dancer of a group sign-up has their own Paid`, async ({ page, adminPage }, testInfo) => {
    void adminPage;
    const klass = await seedEvent({ name: `Own Paid ${tab.type}`, ...(tab.type === 'events' ? { type: 'event' as const } : {}), dayOffset: 3 });
    const [one, two] = tab.type === 'events' ? ['ZZZEvPaidAda', 'ZZZEvPaidBea'] : ['ZZZPaidAda', 'ZZZPaidBea'];
    const id = await seedPaidPair(klass, tab, one.slice(3), two.slice(3));

    await openTab(page, tab, klass);
    // Each dancer has a switch, both on (the sign-up's Paid), off until the lock is taken.
    await expect(paidSwitch(page, tab, one)).toBeChecked();
    await expect(paidSwitch(page, tab, two)).toBeChecked();
    await expect(paidSwitch(page, tab, two)).toBeDisabled();

    await takeLock(page, tab);
    await paidSwitch(page, tab, two).click();
    await expect(paidSwitch(page, tab, two)).not.toBeChecked();
    await expect(paidSwitch(page, tab, two)).toBeEnabled();
    await expect(paidSwitch(page, tab, one)).toBeChecked();
    // Dancer 1 got the sign-up's Paid as their own; the sign-up isn't paid in full any more.
    await expect.poll(() => saved(id)).toEqual([true, false, false]);
    await page.screenshot({ path: testInfo.outputPath(`dancer-paid-${tab.type}.png`) });

    // Still so after a reload.
    await releaseLock(page, tab);
    await openTab(page, tab, klass);
    await expect(paidSwitch(page, tab, one)).toBeChecked();
    await expect(paidSwitch(page, tab, two)).not.toBeChecked();

    await takeLock(page, tab);
    await paidSwitch(page, tab, one).click();
    await expect(paidSwitch(page, tab, one)).not.toBeChecked();
    await expect(paidSwitch(page, tab, one)).toBeEnabled();
    await expect(paidSwitch(page, tab, two)).not.toBeChecked();
    await expect.poll(() => saved(id)).toEqual([false, false, false]);

    // Both paid again: the sign-up is paid in full.
    await paidSwitch(page, tab, one).click();
    await expect(paidSwitch(page, tab, one)).toBeEnabled();
    await paidSwitch(page, tab, two).click();
    await expect(paidSwitch(page, tab, two)).toBeEnabled();
    await expect.poll(() => saved(id)).toEqual([true, true, true]);
    await releaseLock(page, tab);
  });
}

test("Sign-Ups: saving a dancer's edit row changes only their Paid, and a phone's paid dots follow each dancer", async ({ page, adminPage }) => {
  void adminPage;
  const tab = TABS.signups;
  const klass = await seedEvent({ name: 'Own Paid Edit', dayOffset: 4 });
  const id = await seedPaidPair(klass, tab, 'EditPaidAda', 'EditPaidBea');

  await openTab(page, tab, klass);
  await takeLock(page, tab);
  await page.locator(`${tab.body} tr`, { hasText: 'ZZZEditPaidBea' }).locator('.edit-signup-btn').click();
  const editRow = page.locator(`${tab.body} tr[data-signup-edit-row]`);
  await expect(editRow.locator('.paid')).toBeChecked();
  await editRow.locator('.paid').uncheck();
  await editRow.locator('.save-signup-btn').click();
  await expect(page.locator(`${tab.body} .save-signup-btn`)).toHaveCount(0);
  await expect.poll(() => saved(id)).toEqual([true, false, false]);
  await expect(paidSwitch(page, tab, 'ZZZEditPaidAda')).toBeChecked();
  await expect(paidSwitch(page, tab, 'ZZZEditPaidBea')).not.toBeChecked();
  await releaseLock(page, tab);

  // The compact rows' paid dot reads each dancer's own switch.
  await page.setViewportSize({ width: 390, height: 900 });
  await openTab(page, tab, klass);
  await expect(page.locator(`${tab.body} tr`, { hasText: 'ZZZEditPaidAda' })).toHaveAttribute('data-card-paid', 'yes');
  await expect(page.locator(`${tab.body} tr`, { hasText: 'ZZZEditPaidBea' })).toHaveAttribute('data-card-paid', 'no');
});

import { test, expect } from './support/fixtures';
import { db, farFuture, seedEvent, siteZone, sweepTestData, testTitle, track, type Seeded } from './support/db';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Each class keeps its own time zone (events.time_zone, migration 0076): a
// class in another zone shows its own wall-clock time with its zone ("MT")
// everywhere a dancer sees it, on its own day, while a class in the site's
// zone reads as it always did. The site's zone is read, never changed, so the
// other zone is Mountain unless the site itself is on Mountain time.
const NAMES: Record<string, string> = { 'America/Denver': 'Mountain', 'America/New_York': 'Eastern' };
let site: string;
let other: string;
let away: Seeded;
let home: Seeded;
let awayStart: string;
let awayEnd: string;

const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz }).format(new Date(iso));
const time = (iso: string, tz: string) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const label = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', timeZoneName: 'shortGeneric' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')!.value;
const times = (start: string, end: string, tz: string, zone = '') => `${time(start, tz)}–${time(end, tz)}${zone}`;

test.beforeAll(async () => {
  site = await siteZone();
  other = site === 'America/Denver' ? 'America/New_York' : 'America/Denver';
  away = await seedEvent({ name: 'TZ Away Class', timeZone: other, priceDropIn: 15, dayOffset: 40 });
  home = await seedEvent({ name: 'TZ Home Class', dayOffset: 41 });
  // 5:30 AM UTC: late evening in US zones, past midnight in some, so its own day can differ from the site's.
  awayStart = farFuture(40, 5).replace(':00:00.000Z', ':30:00.000Z');
  awayEnd = new Date(Date.parse(awayStart) + 60 * 60 * 1000).toISOString();
  const { error } = await db.from('events').update({ start_time: awayStart, end_time: awayEnd }).eq('id', away.ids[0]);
  if (error) throw new Error(error.message);
});

const homeTimes = async () => {
  const { data } = await db.from('events').select('start_time, end_time, time_zone').eq('id', home.ids[0]).single();
  return { row: data!, text: times(data!.start_time, data!.end_time, site) };
};

test("the homepage shows a class in another zone at its own time with its zone, and a site-zone class as before", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const zone = ` ${label(awayStart, other)}`;
  const awayText = `${fmt(awayStart, other, { weekday: 'short', month: 'short', day: 'numeric' })}, ${times(awayStart, awayEnd, other, zone)}`;
  await expect(page.locator(`[data-offering-key="${away.key}"]`).getByText(awayText, { exact: true })).toBeVisible();

  const { row, text } = await homeTimes();
  // A class saved without a zone gets the site's (the migration's default).
  expect(row.time_zone).toBe(site);
  const homeText = `${fmt(row.start_time, site, { weekday: 'short', month: 'short', day: 'numeric' })}, ${text}`;
  await expect(page.locator(`[data-offering-key="${home.key}"]`).getByText(homeText, { exact: true })).toBeVisible();
});

test('the calendar puts it on its own day, with its own time and zone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const own = dayKey(awayStart, other);
  const [y, m] = own.split('-');
  await page.goto(`/calendar?month=${y}-${m}`);
  const cell = page.locator('.calendar-cell', { has: page.locator('.event-banner', { hasText: away.title }) }).first();
  await expect(cell).toHaveAttribute('data-date', own);
  await expect(cell.locator('.event-banner', { hasText: away.title }).first()).toContainText(times(awayStart, awayEnd, other, ` ${label(awayStart, other)}`));
  // Its details panel too.
  await cell.locator('.event-banner', { hasText: away.title }).first().click();
  await expect(page.locator('#detail-datetime')).toContainText(times(awayStart, awayEnd, other, ` ${label(awayStart, other)}`));
});

test('the registration form and the check-in page label it in its own zone', async ({ page }) => {
  const zone = ` ${label(awayStart, other)}`;
  await page.goto(`/register?series=${encodeURIComponent(away.key)}`);
  await expect(page.locator(`[id="series-sub-${away.key}"]`)).toContainText(times(awayStart, awayEnd, other, zone));
  const { text } = await homeTimes();
  await page.goto(`/register?series=${encodeURIComponent(home.key)}`);
  await expect(page.locator(`[id="series-sub-${home.key}"]`)).toContainText(`${text} (`);

  await page.goto(`/check-in/${away.ids[0]}`);
  await expect(page.getByText(`${fmt(awayStart, other, { weekday: 'long', month: 'long', day: 'numeric' })}, ${times(awayStart, awayEnd, other, zone)}`, { exact: true })).toBeVisible();
});

async function openCalendarAt(page: Page, iso: string, tz: string) {
  const [y, m] = dayKey(iso, tz).split('-');
  await page.goto(`/calendar?month=${y}-${m}`);
  await expect(page.locator('#add-event-btn')).toBeVisible();
}

test('the editor opens a class in another zone with the picker open on its zone, and its own date and times', async ({ page, adminPage }) => {
  void adminPage;
  await openCalendarAt(page, awayStart, other);
  await page.locator('.event-banner', { hasText: away.title }).first().click();
  await page.locator('#detail-edit-btn').click();
  await expect(page.locator('#event-title')).toHaveValue(away.title);
  await expect(page.locator('#event-time-zone-row')).toBeVisible();
  await expect(page.locator('#event-time-zone')).toHaveValue(other);
  await expect(page.locator('#event-time-zone-hint')).toHaveText(`Times are in ${NAMES[other]} time. An end time before the start is the next day.`);
  await expect(page.locator('#event-date')).toHaveValue(dayKey(awayStart, other));
  await expect(page.locator('#event-start-time')).toHaveValue(new Intl.DateTimeFormat('en-GB', { timeZone: other, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(awayStart)));
});

test('a class created in the editor in another zone is stored in that zone at the right instant', async ({ page, adminPage }) => {
  void adminPage;
  const title = testTitle('TZ Created');
  const day = dayKey(farFuture(42), other);
  await openCalendarAt(page, farFuture(42), other);
  await page.locator('#add-event-btn').click();
  await expect(page.locator('#event-modal')).toBeVisible();
  // A new class starts in the site's zone, picker closed.
  await expect(page.locator('#event-time-zone-row')).toBeHidden();
  await expect(page.locator('#event-time-zone')).toHaveValue(site);
  await page.locator('#event-title').fill(title);
  await page.locator('#event-date').fill(day);
  await page.locator('#event-start-time').fill('19:00');
  await page.locator('#event-end-time').fill('20:00');
  await page.locator('#event-time-zone-toggle').click();
  await page.locator('#event-time-zone').selectOption(other);
  await expect(page.locator('#event-time-zone-hint')).toContainText(`Times are in ${NAMES[other]} time.`);
  const response = page.waitForResponse((r) => r.url().includes('/api/admin/create-event'));
  await page.locator('#event-save').click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(200);

  let row: { id: string; time_zone: string; start_time: string; end_time: string; visibility: string } | null = null;
  await expect
    .poll(async () => {
      row = (await db.from('events').select('id, time_zone, start_time, end_time, visibility').eq('title', title).maybeSingle()).data;
      return row?.id ?? null;
    })
    .not.toBeNull();
  track({ title, key: row!.id, ids: [row!.id] });
  // The test server never sends it to Google.
  expect(row!.visibility).toBe('test');
  expect(row!.time_zone).toBe(other);
  expect(dayKey(row!.start_time, other)).toBe(day);
  expect(time(row!.start_time, other)).toBe('7:00 PM');
  expect(time(row!.end_time, other)).toBe('8:00 PM');
});

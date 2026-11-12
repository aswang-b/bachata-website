import { test, expect } from './support/fixtures';
import { db, farFuture, seedEvent, siteZone, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';

// What this file seeds is shared by its tests and swept when the file is done.
test.afterAll(sweepTestData);

// Admin screens show a class in its own zone (events.time_zone, migration
// 0076), with its zone ("MT") after a time only off the site's clock, while
// "now"-level stamps (when someone checked in) stay in the site's zone. The
// site's zone is read, never changed: the class is Mountain unless the site is.
let site: string;
let other: string;
let away: Seeded;
let start: string;
const CHECKIN_NAME = 'ZZZTzAdminCheck';

const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz }).format(new Date(iso));
const label = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', timeZoneName: 'shortGeneric' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')!.value;
const time = (iso: string, tz: string) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
const shortDay = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });

test.beforeAll(async () => {
  site = await siteZone();
  other = site === 'America/Denver' ? 'America/New_York' : 'America/Denver';
  away = await seedEvent({ name: 'TZ Admin Class', timeZone: other, priceDropIn: 15, dayOffset: 43 });
  // 5:30 AM UTC: late evening in US zones, so its own day can differ from the site's.
  start = farFuture(43, 5).replace(':00:00.000Z', ':30:00.000Z');
  const end = new Date(Date.parse(start) + 60 * 60 * 1000).toISOString();
  const { error } = await db.from('events').update({ start_time: start, end_time: end }).eq('id', away.ids[0]);
  if (error) throw new Error(error.message);
  const { error: checkinError } = await db
    .from('class_checkins')
    .insert({ first_name: CHECKIN_NAME, last_name: RUN_ID, phone: '5550142', class_title: away.title, event_id: away.ids[0] });
  if (checkinError) throw new Error(checkinError.message);
});

test("the dashboard's check-in row shows the class's date and time in its own zone, with its zone", async ({ page, adminPage }) => {
  void adminPage;
  await page.goto('/admin/analytics');
  await page.locator('.tab-btn[data-tab="checkins"]').click();
  const row = page.locator('#checkins-body tr', { hasText: CHECKIN_NAME });
  const classDate = `${fmt(start, other, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ${label(start, other)}`;
  await expect(row).toContainText(classDate, { timeout: 30_000 });
});

test('the door sign class picker lists it at its own time with its zone', async ({ page, adminPage }) => {
  void adminPage;
  await page.goto('/admin/qr');
  await expect(page.locator('#qr-admin')).toBeVisible();
  await page.locator('#new-sign').click();
  const item = page.locator('.class-item', { hasText: away.title });
  await expect(item).toContainText(`${shortDay(start, other)}, ${time(start, other)}–`);
  await expect(item).toContainText(` ${label(start, other)}`);
});

test("a notification about it names its own day and time, with its zone", async ({ page, adminPage }) => {
  void adminPage;
  // From the calendar's Notify link: the class is picked and its message filled in (nothing is sent).
  await page.goto(`/admin/notifications?event=${away.ids[0]}`);
  await expect(page.locator('#push-event')).toHaveValue(away.ids[0]);
  await expect(page.locator('#push-event option:checked')).toHaveText(`${away.title} · ${shortDay(start, other)}`);
  await expect(page.locator('#push-body')).toHaveValue(new RegExp(`^${shortDay(start, other)}, ${time(start, other)} ${label(start, other)} at `));
});

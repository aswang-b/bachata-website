import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, siteZone, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';

// Each test deletes the classes it seeded for itself (support/fixtures.ts).
test.afterAll(sweepTestData);

// The dashboard's "Filter by class" on Sign-Ups, Check-Ins and Attendance went
// by title, and by part of a title: two classes with one name were a single
// entry, and a class whose title contained another's was shown under it. It
// goes by the class (its series key) now, told apart by date.
test('the class filters go by class: same-named classes are separate and a longer title is not matched by a shorter one', async ({ page, adminPage }, testInfo) => {
  void adminPage;
  // The name is per attempt: a retry's seeds must not meet the failed attempt's leftovers.
  const name = `Twin Class R${testInfo.retry}`;
  const first = await seedEvent({ name, occurrences: 2, dayOffset: 70 });
  const second = await seedEvent({ name, dayOffset: 80 });
  const longer = await seedEvent({ name: `${name} Advanced`, dayOffset: 90 });
  expect(second.title).toBe(first.title);
  expect(longer.title).toContain(first.title);
  expect(second.key).not.toBe(first.key);
  for (const [klass, who] of [[first, 'TwinOne'], [second, 'TwinTwo'], [longer, 'TwinAdv']] as const) await seedSignup(klass, [{ first: who }]);
  const checkin = (klass: Seeded, who: string, eventId: string) => ({ first_name: `ZZZ${who}`, last_name: RUN_ID, phone: '5550142', class_title: klass.title, event_id: eventId });
  const { error } = await db
    .from('class_checkins')
    .insert([checkin(first, 'TwinOneIn', first.ids[0]), checkin(second, 'TwinTwoIn', second.ids[0]), checkin(longer, 'TwinAdvIn', longer.ids[0])]);
  expect(error).toBeNull();

  const zone = await siteZone();
  const day = async (id: string) => {
    const { data } = await db.from('events').select('start_time').eq('id', id).single();
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(new Date(data!.start_time));
  };
  const weekday = async (id: string) => {
    const { data } = await db.from('events').select('start_time').eq('id', id).single();
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(data!.start_time));
  };

  await page.goto('/admin/analytics');
  const dancer = (who: string) => page.locator('#signups-body tr', { hasText: `ZZZ${who}` });
  await expect(dancer('TwinOne')).toHaveCount(1, { timeout: 30_000 });

  // Sign-Ups: one entry per class, labelled with its date (a series: its range), soonest first.
  const select = page.locator('#signups-class-filters select').first();
  await expect(select.locator('option', { hasText: first.title })).toHaveCount(3);
  await expect(select.locator(`option[value="${first.key}"]`)).toHaveText(`${first.title} · ${await day(first.ids[0])} – ${await day(first.ids[1])}`);
  await expect(select.locator(`option[value="${second.key}"]`)).toHaveText(`${second.title} · ${await weekday(second.ids[0])}`);
  await expect(select.locator(`option[value="${longer.key}"]`)).toHaveText(`${longer.title} · ${await weekday(longer.ids[0])}`);
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.indexOf(first.key)).toBeLessThan(values.indexOf(second.key));
  expect(values.indexOf(second.key)).toBeLessThan(values.indexOf(longer.key));

  const only = async (who: string) => {
    for (const other of ['TwinOne', 'TwinTwo', 'TwinAdv']) await expect(dancer(other)).toHaveCount(other === who ? 1 : 0);
  };
  await select.selectOption(first.key);
  await only('TwinOne');
  await select.selectOption(second.key);
  await only('TwinTwo');
  await select.selectOption(longer.key);
  await only('TwinAdv');

  // The date picker belongs to the series picked: its two dates, then a date narrows to the sign-ups for it.
  await select.selectOption(first.key);
  const dates = page.locator('#signups-class-filters select[aria-label="Date"]');
  await expect(dates.locator('option')).toHaveCount(3);
  await expect(dates.locator(`option[value="${first.ids[1]}"]`)).toHaveCount(1);
  await dates.selectOption(first.ids[1]);
  await only('TwinOne'); // a whole series covers every date
  await select.selectOption(second.key);
  await expect(dates).toHaveCount(0); // a single class has no dates to pick
  await only('TwinTwo');

  // Check-Ins: the same entries, matching by the class each check-in was for.
  await page.locator('.tab-btn[data-tab="checkins"]').click();
  const checkinsSelect = page.locator('#checkins-class-filters select').first();
  await expect(checkinsSelect.locator('option', { hasText: first.title })).toHaveCount(3);
  const arrived = (who: string) => page.locator('#checkins-body tr', { hasText: `ZZZ${who}In` });
  const onlyArrived = async (who: string) => {
    for (const other of ['TwinOne', 'TwinTwo', 'TwinAdv']) await expect(arrived(other)).toHaveCount(other === who ? 1 : 0);
  };
  await checkinsSelect.selectOption(first.key);
  await onlyArrived('TwinOne');
  await checkinsSelect.selectOption(second.key);
  await onlyArrived('TwinTwo');
  await checkinsSelect.selectOption(longer.key);
  await onlyArrived('TwinAdv');
  await checkinsSelect.selectOption(first.key);
  const checkinDates = page.locator('#checkins-class-filters select[aria-label="Date"]');
  await checkinDates.selectOption(first.ids[1]); // nobody checked in on the second date
  await expect(arrived('TwinOne')).toHaveCount(0);
  await checkinDates.selectOption(first.ids[0]);
  await onlyArrived('TwinOne');

  // Attendance: entries for the same classes.
  await page.locator('.tab-btn[data-tab="attendance"]').click();
  const attendanceSelect = page.locator('#attendance-class-filters select').first();
  await expect(attendanceSelect.locator('option', { hasText: first.title })).toHaveCount(3);
  const expected = (who: string) => page.locator('#attendance-matches-body tr', { hasText: `ZZZ${who}` });
  await attendanceSelect.selectOption(second.key);
  await expect(expected('TwinTwo').first()).toBeVisible();
  await expect(expected('TwinOne')).toHaveCount(0);
  await expect(expected('TwinAdv')).toHaveCount(0);
  await attendanceSelect.selectOption(longer.key);
  await expect(expected('TwinAdv').first()).toBeVisible();
  await expect(expected('TwinTwo')).toHaveCount(0);
  await expect(expected('TwinOne')).toHaveCount(0);
});

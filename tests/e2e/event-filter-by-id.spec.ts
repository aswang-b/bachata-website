import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, siteZone, sweepTestData } from './support/db';

// Each test deletes the classes it seeded for itself (support/fixtures.ts).
test.afterAll(sweepTestData);

// The Event Registration tab's "Filter by event" went by title, so two events
// with one name (the Besito socials) were a single option and their dancers
// ran together. It goes by the event now, told apart by date.
test('two events with the same name are separate, dated filter options with their own dancers', async ({ page, adminPage }, testInfo) => {
  void adminPage;
  // The name is per attempt: a retry's seeds must not meet the failed attempt's leftovers.
  const name = `Twin Social R${testInfo.retry}`;
  const first = await seedEvent({ name, type: 'event', priceWhole: 10, dayOffset: 70 });
  const second = await seedEvent({ name, type: 'event', priceWhole: 10, dayOffset: 71 });
  expect(second.title).toBe(first.title);
  expect(second.key).not.toBe(first.key);
  await seedSignup(first, [{ first: 'TwinFirst' }], 'events');
  await seedSignup(second, [{ first: 'TwinSecond' }], 'events');

  const zone = await siteZone();
  const dateOf = async (id: string) => {
    const { data } = await db.from('events').select('start_time').eq('id', id).single();
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(data!.start_time));
  };
  const firstDate = await dateOf(first.ids[0]);
  const secondDate = await dateOf(second.ids[0]);
  expect(firstDate).not.toBe(secondDate);

  await page.goto('/admin/analytics');
  await page.locator('.tab-btn[data-tab="event-registration"]').click();
  const filter = page.locator('#event-registrations-event-filter');
  await expect(filter.locator('option', { hasText: first.title })).toHaveCount(2, { timeout: 30_000 });
  await expect(filter.locator(`option[value="${first.key}"]`)).toHaveText(`${first.title} · ${firstDate}`);
  await expect(filter.locator(`option[value="${second.key}"]`)).toHaveText(`${second.title} · ${secondDate}`);
  // Soonest first.
  const values = await filter.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.indexOf(first.key)).toBeLessThan(values.indexOf(second.key));

  const rows = page.locator('#event-registrations-body tr');
  await filter.selectOption(first.key);
  await expect(rows.filter({ hasText: 'ZZZTwinFirst' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'ZZZTwinSecond' })).toHaveCount(0);
  await expect(page.locator('#event-registrations-count')).toHaveText('1 result');

  await filter.selectOption(second.key);
  await expect(rows.filter({ hasText: 'ZZZTwinSecond' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'ZZZTwinFirst' })).toHaveCount(0);
  await expect(page.locator('#event-registrations-count')).toHaveText('1 result');
});

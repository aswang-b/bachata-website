import { test, expect } from './support/fixtures';
import { db, seedEvent, siteHome, siteZone, sweepTestData, type Seeded } from './support/db';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// A class holds the city it is in (events.city/state, migration 0077) and
// names it, "Venue · Santa Fe", only when that isn't the home city (Admin →
// Where we are, read here, never changed). Classes at home or with no city
// print just their venue, as they always did.
const VENUE = 'ZZZ Test Studio';
let home: { city: string; state: string };
let awayName: string;
let away: Seeded;
let atHome: Seeded;
let noCity: Seeded;
let cityOnly: Seeded;

async function monthOf(s: Seeded): Promise<string> {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  return new Intl.DateTimeFormat('en-CA', { timeZone: await siteZone(), year: 'numeric', month: '2-digit' }).format(new Date(data!.start_time));
}

async function calendarMonth(page: Page, s: Seeded) {
  await page.goto(`/calendar?month=${await monthOf(s)}`);
}

test.beforeAll(async () => {
  home = await siteHome();
  awayName = home.city.toLowerCase() === 'santa fe' ? 'Taos' : 'Santa Fe';
  away = await seedEvent({ name: 'City Away', city: awayName, state: 'NM', priceDropIn: 15, dayOffset: 50 });
  atHome = await seedEvent({ name: 'City Home', city: home.city.toUpperCase(), state: home.state, dayOffset: 51 });
  noCity = await seedEvent({ name: 'City None', dayOffset: 52 });
  cityOnly = await seedEvent({ name: 'City No Venue', city: awayName, state: 'NM', dayOffset: 53 });
  const { error } = await db.from('events').update({ location: null }).eq('id', cityOnly.ids[0]);
  if (error) throw new Error(error.message);
});

test('the homepage block names the city after the venue only when the class is away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const venue = (s: Seeded) => page.locator(`[data-offering-key="${s.key}"] a.pin-link`);
  await expect(venue(away)).toHaveText(`${VENUE} · ${awayName}`);
  await expect(venue(atHome)).toHaveText(VENUE);
  await expect(venue(noCity)).toHaveText(VENUE);
  // No venue text: just the city.
  await expect(venue(cityOnly)).toHaveText(awayName);
});

test('the calendar names the city in the details panel and the list, and leaves the month grid as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await calendarMonth(page, away);
  // The banner's hover card is unchanged.
  await expect(page.locator('.event-banner', { hasText: away.title }).first().locator('.event-tooltip a.pin-link')).toHaveText(VENUE);
  await page.locator('.event-banner', { hasText: away.title }).first().click();
  await expect(page.locator('#detail-location')).toHaveText(`${VENUE} · ${awayName}`);

  await page.locator('#view-toggle-list').click();
  await expect(page.locator('#list-view > div', { hasText: away.title }).first().locator('a.pin-link')).toHaveText(`${VENUE} · ${awayName}`);
  await expect(page.locator('#list-view > div', { hasText: noCity.title }).first().locator('a.pin-link')).toHaveText(VENUE);
  await expect(page.locator('#list-view > div', { hasText: atHome.title }).first().locator('a.pin-link')).toHaveText(VENUE);
  await expect(page.locator('#list-view > div', { hasText: cityOnly.title }).first().locator('a.pin-link')).toHaveText(awayName);

  // Grid view again: a home-city class's panel reads as it always did.
  await page.locator('#view-toggle-calendar').click();
  await page.locator('.event-banner', { hasText: atHome.title }).first().click();
  await expect(page.locator('#detail-location')).toHaveText(VENUE);
  await page.locator('.event-banner', { hasText: cityOnly.title }).first().click();
  await expect(page.locator('#detail-location')).toHaveText(awayName);
});

test('the registration form labels an away class with its city, and a home class as before', async ({ page }) => {
  const line = (s: Seeded) => page.locator(`[id="series-sub-${s.key}"]`).locator('xpath=..').locator('a.pin-link');
  await page.goto(`/register?series=${encodeURIComponent(away.key)}`);
  await expect(line(away)).toHaveText(`${VENUE} · ${awayName}`);
  await expect(line(atHome)).toHaveText(VENUE);
  await expect(line(noCity)).toHaveText(VENUE);
});

async function openEditor(page: Page, s: Seeded) {
  await calendarMonth(page, s);
  await expect(page.locator('#add-event-btn')).toBeVisible();
  await page.locator('.event-banner', { hasText: s.title }).first().click();
  await page.locator('#detail-edit-btn').click();
  await expect(page.locator('#event-title')).toHaveValue(s.title);
}

async function saveEditor(page: Page) {
  const response = page.waitForResponse((r) => r.url().includes('/api/admin/update-event'));
  await page.locator('#event-save').click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(200);
}

const storedPlace = async (s: Seeded) => (await db.from('events').select('location, city, state').eq('id', s.ids[0]).single()).data;

test('re-saving a class without touching Location keeps its city; typing a new location by hand clears it', async ({ page, adminPage }) => {
  void adminPage;
  const own = await seedEvent({ name: 'City Editor', city: awayName, state: 'NM', dayOffset: 54 });
  await openEditor(page, own);
  await expect(page.locator('#event-location')).toHaveValue(VENUE);
  await page.locator('#event-title').fill(`${own.title} edited`);
  await saveEditor(page);
  await expect.poll(async () => (await storedPlace(own))?.city).toBe(awayName);
  expect(await storedPlace(own)).toMatchObject({ location: VENUE, state: 'NM' });

  await openEditor(page, { ...own, title: `${own.title} edited` });
  await page.locator('#event-location').fill('ZZZ Typed By Hand');
  await saveEditor(page);
  await expect.poll(async () => (await storedPlace(own))?.location).toBe('ZZZ Typed By Hand');
  expect(await storedPlace(own)).toMatchObject({ city: null, state: null });
});

test("a Places pick saves the venue's city and state", async ({ page, adminPage }) => {
  void adminPage;
  // Google's script is stood in for: importLibrary hands back an Autocomplete the test drives.
  await page.route('https://maps.googleapis.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `(() => {
        const ready = google.maps.__ib__;
        google.maps.event = { clearInstanceListeners() {} };
        google.maps.importLibrary = async () => ({
          Autocomplete: class {
            constructor(input, options) { this.input = input; this.listeners = {}; window.__autocompleteFields = options.fields; window.__autocomplete = this; }
            addListener(name, fn) { this.listeners[name] = fn; }
            getPlace() { return window.__nextPlace; }
          },
        });
        ready && ready();
      })();`,
    })
  );
  const own = await seedEvent({ name: 'City Places', dayOffset: 55 });
  await openEditor(page, own);
  await page.waitForFunction(() => Boolean((window as unknown as { __autocomplete?: unknown }).__autocomplete));
  expect(await page.evaluate(() => (window as unknown as { __autocompleteFields: string[] }).__autocompleteFields)).toContain('address_components');
  await page.evaluate(() => {
    const w = window as unknown as { __nextPlace: unknown; __autocomplete: { listeners: Record<string, () => void> } };
    w.__nextPlace = {
      name: 'ZZZ Moxie Studio',
      address_components: [
        { long_name: 'Santa Fe', short_name: 'Santa Fe', types: ['locality', 'political'] },
        { long_name: 'New Mexico', short_name: 'NM', types: ['administrative_area_level_1', 'political'] },
      ],
    };
    w.__autocomplete.listeners.place_changed();
  });
  await expect(page.locator('#event-location')).toHaveValue('ZZZ Moxie Studio');
  await saveEditor(page);
  await expect.poll(async () => (await storedPlace(own))?.city).toBe('Santa Fe');
  expect(await storedPlace(own)).toMatchObject({ location: 'ZZZ Moxie Studio', state: 'NM' });
});

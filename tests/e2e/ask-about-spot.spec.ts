import { randomUUID } from 'node:crypto';
import { test, expect, postForm } from './support/fixtures';
import { bearer } from './support/admin';
import { db, seedEvent, seedSignup, siteZone, sweepTestData, track, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// "Ask about a spot" (lib/askAboutSpot.ts): a full or closed class still to
// come offers a link to the Contact form with the class named; a class with
// spots left offers none. There is no waitlist: the message lands in the inbox.
let full: Seeded;
let closed: Seeded;
let roleFull: Seeded;
let roomy: Seeded;
let plain: Seeded;

test.beforeAll(async () => {
  full = await seedEvent({ name: 'Spot Full', capacity: 1, showCapacity: true, dayOffset: 60 });
  await seedSignup(full, [{ first: 'SpotTaken', role: 'leader' }]);
  closed = await seedEvent({ name: 'Spot Closed', registrationClosed: true, dayOffset: 61 });
  roleFull = await seedEvent({ name: 'Spot Role Full', capacityByRole: true, leaderCapacity: 1, followerCapacity: 3, showCapacity: true, dayOffset: 62 });
  await seedSignup(roleFull, [{ first: 'SpotLeader', role: 'leader' }]);
  roomy = await seedEvent({ name: 'Spot Roomy', capacity: 5, showCapacity: true, dayOffset: 63 });
  plain = await seedEvent({ name: 'Spot Plain', dayOffset: 64 });
});

const href = (id: string) => `/contact?spot=${encodeURIComponent(id)}`;
const row = (page: Page, s: Seeded) => page.locator(`[data-offering-key="${s.key}"]`);

async function monthOf(startTime: string): Promise<string> {
  return new Intl.DateTimeFormat('en-CA', { timeZone: await siteZone(), year: 'numeric', month: '2-digit' }).format(new Date(startTime));
}

async function calendarMonth(page: Page, s: Seeded) {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  await page.goto(`/calendar?month=${await monthOf(data!.start_time)}`);
}

// The class's date as the message names it ("Nov 4"), in the site's zone (the seeded classes have no zone of their own).
async function shortDate(s: Seeded): Promise<string> {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  return new Intl.DateTimeFormat('en-US', { timeZone: await siteZone(), month: 'short', day: 'numeric' }).format(new Date(data!.start_time));
}

test('the homepage block of a full, closed or role-full class offers the link under its pill, and a class with spots left does not', async ({ page }) => {
  await page.goto('/');
  for (const s of [full, closed, roleFull]) {
    const link = row(page, s).locator('[data-ask-spot]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Ask about a spot');
    await expect(link).toHaveAttribute('href', href(s.key));
  }
  await expect(row(page, full)).toContainText('Full');
  await expect(row(page, closed)).toContainText('Registration closed');
  await expect(row(page, roleFull).locator('[data-public-spots]')).toHaveText('Leaders full · 3 follower spots left');
  // The link sits under the Full / Closed pill, not inside the block's price row.
  const pill = await row(page, full).getByText('Full', { exact: true }).last().boundingBox();
  const linkBox = await row(page, full).locator('[data-ask-spot]').boundingBox();
  expect(linkBox!.y).toBeGreaterThan(pill!.y + pill!.height - 1);

  for (const s of [roomy, plain]) {
    await expect(row(page, s)).toBeVisible();
    await expect(row(page, s).locator('[data-ask-spot]')).toHaveCount(0);
    await expect(row(page, s).locator('a', { hasText: 'Register' })).toBeVisible();
  }
});

test("the calendar's details panel offers the link beside the button for a full or closed class only", async ({ page }) => {
  // The classes sit on five days in a row, which can cross into the next month (depending on today's date):
  // open each one's own month, staying on the page while it's the same one.
  let shownMonth = '';
  const open = async (s: Seeded) => {
    const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
    const month = await monthOf(data!.start_time);
    if (month !== shownMonth) await page.goto(`/calendar?month=${(shownMonth = month)}`);
    await page.locator('.event-banner', { hasText: s.title }).first().click();
  };
  const ask = page.locator('#detail-ask-spot');

  await open(full);
  await expect(page.locator('#detail-spots')).toHaveText('Full');
  await expect(ask).toHaveText('Ask about a spot');
  // The very class date the panel shows.
  await expect(ask).toHaveAttribute('href', href(full.ids[0]));

  await open(closed);
  await expect(page.locator('#detail-register-btn')).toHaveText('Registration Closed');
  await expect(ask).toHaveAttribute('href', href(closed.ids[0]));
  await expect(ask).toHaveCount(1);

  await open(roleFull);
  await expect(page.locator('#detail-spots')).toHaveText('Leaders full · 3 follower spots left');
  await expect(ask).toHaveAttribute('href', href(roleFull.ids[0]));

  // Spots left, or no capacity: no link, and the one from the last class is gone.
  await open(roomy);
  await expect(page.locator('#detail-spots')).toHaveText('5 spots remaining');
  await expect(page.locator('#detail-register-btn')).toHaveText('Register Now');
  await expect(ask).toHaveCount(0);
  await open(plain);
  await expect(page.locator('#detail-title')).toContainText(plain.title);
  await expect(ask).toHaveCount(0);
});

test('a class that is closed but already past offers no link, and neither does the admin calendar', async ({ page, adminPage }) => {
  void adminPage;
  // Older than the calendar sync's 180-day window, with a fake Google id, like every seeded class.
  const start = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  start.setUTCHours(1, 0, 0, 0);
  const title = `ZZZ E2E ${RUN_ID} Spot Past`;
  const { data, error } = await db
    .from('events')
    .insert({
      title,
      event_type: 'class',
      visibility: 'test',
      color: 'green',
      location: 'ZZZ Test Studio',
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3600_000).toISOString(),
      google_event_id: `zzz-e2e-${randomUUID()}`,
      price_whole_series: 50,
      registration_closed: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Seeding the past class failed: ${error?.message}`);
  const past = track({ title, key: data.id, ids: [data.id] });

  await page.goto(`/calendar?month=${await monthOf(start.toISOString())}`);
  await page.locator('.event-banner', { hasText: past.title }).first().click();
  await expect(page.locator('#detail-register-btn')).toHaveText('Registration Closed');
  await expect(page.locator('#detail-ask-spot')).toHaveCount(0);

  // Signed in as the admin, a class that is still to come and closed has none either.
  await calendarMonth(page, closed);
  // The panel decides on its admin buttons when a class is opened, so wait for admin mode first.
  await expect(page.locator('#add-event-btn')).toBeVisible();
  await page.locator('.event-banner', { hasText: closed.title }).first().click();
  await expect(page.locator('#detail-register-btn')).toHaveText('Registration Closed');
  await expect(page.locator('#detail-ask-spot')).toHaveCount(0);
});

test('the registration form offers one link per full, closed or role-full class, and none for a class with room', async ({ page }) => {
  await page.goto('/register');
  for (const s of [full, closed, roleFull]) {
    const link = page.locator(`.series-item[data-key="${s.key}"] [data-ask-spot]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', href(s.key));
    await expect(link).toBeVisible();
  }
  await expect(page.locator(`.series-item[data-key="${full.key}"]`)).toContainText('Full');
  await expect(page.locator(`.series-item[data-key="${roleFull.key}"]`)).toContainText('Leaders full');
  for (const s of [roomy, plain]) {
    await expect(page.locator(`.series-item[data-key="${s.key}"]`)).toBeVisible();
    await expect(page.locator(`.series-item[data-key="${s.key}"] [data-ask-spot]`)).toHaveCount(0);
  }
  // The link is a plain link: it leaves the form for the contact page.
  await page.locator(`.series-item[data-key="${full.key}"] [data-ask-spot]`).click();
  await expect(page).toHaveURL(new RegExp(`/contact\\?spot=${full.key}`));
});

test('a series whose Whole Series is full but still takes Drop-Ins offers one link with its choices', async ({ page, request }) => {
  const series = await seedEvent({ name: 'Spot Dropin', occurrences: 2, priceWhole: 50, priceDropIn: 15, capacity: 1, showCapacity: true, dayOffset: 70 });
  const dancers = JSON.stringify([{ firstName: 'ZZZSpotDrop', lastName: RUN_ID, role: 'leader', phone: '6085550141', email: '' }]);
  const selection = JSON.stringify([{ key: series.key, title: series.title, label: '', mode: 'dropin', occurrenceEventId: series.ids[0] }]);
  const res = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: series.title, payment_method: 'cash', class_selections: selection, dancers });
  expect(res.status()).toBe(303);

  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${series.key}"]`);
  await expect(item).toContainText('Whole series full · Drop-ins open');
  await expect(item.locator('[data-ask-spot]')).toHaveCount(1);
  await expect(item.locator('[data-ask-spot]')).toHaveAttribute('href', href(series.key));
  await item.locator('.series-toggle-btn').click();
  await expect(item.locator('.series-subchoice [data-ask-spot]')).toBeVisible();
  await expect(item.locator('.occurrence-btn').first()).toBeDisabled();

  // The series key names the series' next class on the contact page.
  await page.goto(href(series.key));
  await expect(page.locator('#spot-line')).toContainText(`Asking about a spot in ${series.title} · `);
});

test('on a phone the link has a 44px tap area', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  await page.goto('/');
  const tap = await row(page, full).locator('[data-ask-spot]').evaluate((a) => parseFloat(getComputedStyle(a, '::after').height));
  expect(tap).toBeGreaterThanOrEqual(44);
  await page.goto('/register');
  const tapForm = await page.locator(`.series-item[data-key="${full.key}"] [data-ask-spot]`).evaluate((a) => parseFloat(getComputedStyle(a, '::after').height));
  expect(tapForm).toBeGreaterThanOrEqual(44);
  await phone.close();
});

test('the link opens the contact form naming the class, with the message started, and the message lands in the inbox naming it', async ({ page, request, adminPage, admin }, testInfo) => {
  void adminPage;
  const date = await shortDate(full);
  await page.goto('/');
  await row(page, full).locator('[data-ask-spot]').click();
  await expect(page).toHaveURL(new RegExp(`/contact\\?spot=${full.key}$`));

  const line = page.locator('#spot-line');
  const prefix = `Asking about a spot in ${full.title} · `;
  const text = (await line.textContent())!.trim();
  expect(text.startsWith(prefix)).toBe(true);
  expect(text.slice(prefix.length)).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{1,2}:\d{2} [AP]M–\d{1,2}:\d{2} [AP]M$/);
  const message = page.locator('textarea[name="comments"]');
  await expect(message).toHaveValue(`I'd like to ask about a spot in ${full.title} (${date}).`);
  // The most it takes leaves room for the line saved in front of it.
  await expect(message).toHaveAttribute('maxlength', String(2000 - `[Spot request: ${full.title}, ${date}]`.length - 1));
  // Only the id goes back with the form.
  await expect(page.locator('input[name="spot"]')).toHaveValue(full.key);
  expect(await page.locator('form input[type="hidden"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name))).toEqual(['registration_type', 'spot']);

  // Edited, it is the dancer's own words that are sent, behind the class.
  const first = `ZZZSpotAsk${testInfo.retry}`;
  await message.fill(`${(await message.inputValue()).trim()} Any chance of a cancellation? ${RUN_ID}`);
  await page.locator('input[name="first_name"]').fill(first);
  await page.locator('input[name="last_name"]').fill(RUN_ID);
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.locator('input[name="email"]').fill(`zzz-e2e-${RUN_ID.toLowerCase()}-spot${testInfo.retry}@example.com`);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/contact\/confirmation/);

  const { data } = await db.from('contact_messages').select('id, message').eq('first_name', first).eq('last_name', RUN_ID);
  expect(data).toHaveLength(1);
  expect(data![0].message).toBe(`[Spot request: ${full.title}, ${date}]\nI'd like to ask about a spot in ${full.title} (${date}). Any chance of a cancellation? ${RUN_ID}`);

  const inbox = await (await request.get('/api/admin/inbox-data', { headers: bearer(admin) })).json();
  expect(inbox.messages.find((m: { id: string }) => m.id === data![0].id)?.message).toContain(`[Spot request: ${full.title}, ${date}]`);
  await page.goto('/admin/inbox');
  await expect(page.locator(`#messages-list .contact-message[data-id="${data![0].id}"]`)).toContainText(`[Spot request: ${full.title}, ${date}]`);

  await db.from('contact_messages').delete().eq('id', data![0].id);
  const { count } = await db.from('contact_messages').select('id', { count: 'exact', head: true }).eq('first_name', first).eq('last_name', RUN_ID);
  expect(count).toBe(0);
});

test("the dancer's own text survives going Back to the form, and a series' key names its next class", async ({ page }) => {
  await page.goto(`/contact?spot=${full.ids[0]}`);
  const message = page.locator('textarea[name="comments"]');
  await message.fill('My own words, typed before I left the page.');
  await page.goto('/about');
  await page.goBack();
  await expect(message).toHaveValue('My own words, typed before I left the page.');
  await expect(page.locator('#spot-line')).toContainText(full.title);
});

test('the class text comes from the server, never from the browser', async ({ request }, testInfo) => {
  const first = `ZZZSpotForged${testInfo.retry}`;
  const res = await postForm(request, '/api/submit-intake', {
    registration_type: 'private',
    first_name: first,
    last_name: RUN_ID,
    phone: '6085550142',
    comments: 'Hello',
    spot: full.ids[0],
    spot_title: 'Forged Class',
    class: 'Forged Class',
  });
  expect(res.status()).toBe(303);
  const { data } = await db.from('contact_messages').select('message').eq('first_name', first).eq('last_name', RUN_ID);
  expect(data).toHaveLength(1);
  expect(data![0].message).toMatch(new RegExp(`^\\[Spot request: ${full.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, [A-Z][a-z]{2} \\d+\\]\\nHello$`));
  expect(data![0].message).not.toContain('Forged');
});

test('an unknown, malformed or non-public id gives the ordinary contact page', async ({ page, request }) => {
  const ordinary = async (id: string) => {
    await page.goto(`/contact?spot=${encodeURIComponent(id)}`);
    await expect(page.getByRole('heading', { name: 'Contact Me' })).toBeVisible();
    await expect(page.locator('#spot-line')).toHaveCount(0);
    await expect(page.locator('input[name="spot"]')).toHaveCount(0);
    await expect(page.locator('textarea[name="comments"]')).toHaveValue('');
  };
  await ordinary('garbage');
  await ordinary("x'; drop table events; --");
  await ordinary('00000000-0000-4000-8000-000000000000');
  await ordinary('');

  // A private class is no class here.
  const hidden = await seedEvent({ name: 'Spot Hidden', registrationClosed: true, dayOffset: 71 });
  const { error } = await db.from('events').update({ visibility: 'private' }).eq('id', hidden.ids[0]);
  if (error) throw new Error(error.message);
  await ordinary(hidden.ids[0]);
  expect((await request.get('/contact?spot=garbage')).status()).toBe(200);
});

test('a contact page opened from the link is kept out of the shared cache, and the plain page stays cached', async ({ request }) => {
  const plainPage = await request.get('/contact');
  expect(plainPage.headers()['netlify-cdn-cache-control']).toContain('s-maxage=60');
  expect(plainPage.headers()['netlify-vary']).toBe('query=spot');
  for (const id of [full.ids[0], full.key, 'garbage']) {
    const res = await request.get(href(id));
    expect(res.headers()['netlify-cdn-cache-control']).toBe('no-store');
    expect(res.headers()['netlify-vary']).toBeUndefined();
  }
});

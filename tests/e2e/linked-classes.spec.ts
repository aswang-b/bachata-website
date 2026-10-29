import { test, expect } from './support/fixtures';
import { db, seedEvent, seedLink, sweepTestData, testTitle, track, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

// The editor's "Linked Classes/Events" section (src/lib/linkedClassesEditor.ts):
// linking whole series, the shared flyer, the rules between linked pairs, and
// "New linked class". Each test seeds and cleans up its own classes; links
// are removed with them (support/db.ts).
test.afterAll(sweepTestData);

// A URL in the site's image bucket, so the editor's save accepts it (no file is uploaded).
const flyer = (name: string) => db.storage.from('event-images').getPublicUrl(`zzz-e2e-${RUN_ID}-link-${name}.png`).data.publicUrl;

async function openEditor(page: Page, s: Seeded) {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  const d = new Date(data!.start_time);
  await page.goto(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  await expect(page.locator('#add-event-btn')).toBeVisible();
  await page.locator('.event-banner', { hasText: s.title }).first().click();
  await page.locator('#detail-edit-btn').click();
  await expect(page.locator('#event-title')).toHaveValue(s.title);
}

async function openLinked(page: Page) {
  await page.locator('.event-nav-btn[data-section="linked"]').click();
  await expect(page.locator('#sec-linked')).toHaveAttribute('open', '');
}

const linksOf = async (keys: string[]) => (await db.from('event_links').select('series_key, link_group_id').in('series_key', keys)).data ?? [];
const rulesOf = async (keys: string[]) =>
  (await db.from('event_link_rules').select('key_a, key_b, kind, reason').in('key_a', keys).in('key_b', keys)).data ?? [];

test('linking from the editor links whole series, shares the flyer, and offers past classes on their own tab', async ({ page, adminPage }) => {
  void adminPage;
  const workshop = await seedEvent({ name: 'Link Workshop', type: 'event', flyerUrl: flyer('workshop') });
  const practica = await seedEvent({ name: 'Link Practica', type: 'event', occurrences: 2, dayOffset: 1 });
  // A past event (test classes are never synced, so a past date is safe).
  const pastTitle = testTitle('Link Past Social');
  const { data: past } = await db
    .from('events')
    .insert({ title: pastTitle, event_type: 'event', visibility: 'test', color: 'green', start_time: '2025-01-10T01:00:00Z', end_time: '2025-01-10T02:00:00Z', google_event_id: `zzz-e2e-${randomUUID()}` })
    .select('id')
    .single();
  track({ title: pastTitle, key: past!.id, ids: [past!.id] });

  await openEditor(page, workshop);
  await openLinked(page);
  await expect(page.locator('[data-summary="linked"]').first()).toHaveText('Not linked');
  await page.locator('#linked-add-btn').click();
  await expect(page.locator('#link-picker-title')).toHaveText('Link an event');

  // Upcoming lists the practica (once, as a series) and not the past one.
  await page.locator('#link-picker-search').fill(`E2E ${RUN_ID} Link`);
  await expect(page.locator('.link-picker-option', { hasText: practica.title })).toHaveCount(1);
  await expect(page.locator('.link-picker-option', { hasText: pastTitle })).toHaveCount(0);
  await page.locator('.link-picker-tab[data-tab="past"]').click();
  await expect(page.locator('.link-picker-option', { hasText: pastTitle })).toHaveCount(1);
  await page.locator('.link-picker-tab[data-tab="upcoming"]').click();

  await page.locator('.link-picker-option', { hasText: practica.title }).click();
  await expect(page.locator('#link-picker-confirm-text')).toContainText('Every class in both series is linked');
  const linked = page.waitForResponse((r) => r.url().includes('/api/admin/event-links') && r.request().method() === 'POST');
  await page.locator('#link-picker-confirm-btn').click();
  expect((await linked).status()).toBe(200);

  await expect(page.locator('#linked-list')).toContainText(practica.title);
  const links = await linksOf([workshop.key, practica.key]);
  expect(links).toHaveLength(2);
  expect(links[0].link_group_id).toBe(links[1].link_group_id);
  // Every occurrence of the practica series took the workshop's flyer.
  const { data: practicaRows } = await db.from('events').select('flyer_url').in('id', practica.ids);
  expect(practicaRows!.map((r) => r.flyer_url)).toEqual([flyer('workshop'), flyer('workshop')]);
});

test('rules: includes with a default note, a custom note, and a contradiction refused', async ({ page, adminPage }) => {
  void adminPage;
  const workshop = await seedEvent({ name: 'Rule Workshop', type: 'event' });
  const practica = await seedEvent({ name: 'Rule Practica', type: 'event', dayOffset: 1 });
  const level2 = await seedEvent({ name: 'Rule Level 2', type: 'event', dayOffset: 2 });
  await seedLink(workshop, practica);
  await seedLink(workshop, level2);
  // seedLink makes a group per call; put all three in one.
  const { data: group } = await db.from('event_links').select('link_group_id').eq('series_key', workshop.key).single();
  await db.from('event_links').update({ link_group_id: group!.link_group_id }).in('series_key', [practica.key, level2.key]);

  await openEditor(page, workshop);
  await openLinked(page);
  const pair = (a: Seeded, b: Seeded) => page.locator(`.linked-rule[data-a="${a.key}"][data-b="${b.key}"], .linked-rule[data-a="${b.key}"][data-b="${a.key}"]`);
  await expect(page.locator('.linked-rule')).toHaveCount(3);
  await expect(page.locator('#linked-choose-one-btn')).toBeVisible();

  // Workshop includes Practica: the note box shows the default wording as its placeholder.
  const wp = pair(workshop, practica);
  await wp.locator('select').selectOption({ label: `${workshop.title} includes ${practica.title}` });
  await expect(wp.locator('.linked-rule-reason')).toHaveAttribute('placeholder', `${practica.title} is included with ${workshop.title}, so you won't be charged for it twice.`);
  expect(await rulesOf([workshop.key, practica.key])).toHaveLength(1);

  // A custom note saves when the box is left.
  await wp.locator('.linked-rule-reason').fill('The practica comes with the workshop.');
  await wp.locator('.linked-rule-reason').blur();
  await expect.poll(async () => (await rulesOf([workshop.key, practica.key]))[0]?.reason).toBe('The practica comes with the workshop.');

  // Workshop also includes Level 2, then Practica and Level 2 "cannot take both": refused.
  await pair(workshop, level2).locator('select').selectOption({ label: `${workshop.title} includes ${level2.title}` });
  await expect.poll(async () => (await rulesOf([workshop.key, level2.key])).length).toBe(1);
  await pair(practica, level2).locator('select').selectOption('exclusive');
  await expect(page.locator('#linked-error')).toContainText('Cannot take both');
  expect(await rulesOf([practica.key, level2.key])).toHaveLength(0);
  await expect(pair(practica, level2).locator('select')).toHaveValue('both');

  // The summary lists what dancers can sign up for.
  await expect(page.locator('#linked-summary')).toContainText(`${workshop.title} (includes`);
});

test('unlinking removes the link and its rules; a set of one is no longer linked', async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Unlink A' });
  const b = await seedEvent({ name: 'Unlink B', dayOffset: 1 });
  await seedLink(a, b, { kind: 'exclusive' });

  await openEditor(page, a);
  await openLinked(page);
  page.once('dialog', (d) => d.accept());
  await page.locator('.linked-unlink-btn').click();
  await expect(page.locator('#linked-list li')).toHaveCount(0);
  expect(await linksOf([a.key, b.key])).toHaveLength(0);
  expect(await rulesOf([a.key, b.key])).toHaveLength(0);
});

test('"New linked class" copies the class with a blank title and links the new one when saved', async ({ page, adminPage }) => {
  void adminPage;
  const source = await seedEvent({ name: 'Copy Source', priceWhole: 35, flyerUrl: flyer('copy') });
  await openEditor(page, source);
  await openLinked(page);
  await page.locator('#linked-add-btn').click();
  await page.locator('.link-picker-option[data-new]').click();

  await expect(page.locator('#modal-heading')).toHaveText('New linked class');
  await expect(page.locator('#event-title')).toHaveValue('');
  await expect(page.locator('#event-price-whole-series')).toHaveValue('35');
  await expect(page.locator('#linked-intro')).toContainText(`linked with ${source.title}`);

  const copyTitle = testTitle('Copy Linked');
  await page.locator('#event-title').fill(copyTitle);
  const created = page.waitForResponse((r) => r.url().includes('/api/admin/create-event'));
  await page.locator('#event-save').click();
  const body = await (await created).json();
  expect(body.linkError).toBeNull();

  const { data: copy } = await db.from('events').select('id, flyer_url, visibility, price_whole_series').eq('id', body.id).single();
  expect(copy).toMatchObject({ flyer_url: flyer('copy'), visibility: 'test', price_whole_series: 35 });
  const links = await linksOf([source.key, copy!.id]);
  expect(links).toHaveLength(2);
});

test('a new flyer on one linked class goes on every linked class', async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Flyer A', flyerUrl: flyer('old') });
  const b = await seedEvent({ name: 'Flyer B', dayOffset: 1, occurrences: 2, flyerUrl: flyer('old') });
  await seedLink(a, b);

  await openEditor(page, a);
  await page.locator('#event-flyer-url').evaluate((el, url) => ((el as HTMLInputElement).value = url), flyer('new'));
  const saved = page.waitForResponse((r) => r.url().includes('/api/admin/update-event'));
  await page.locator('#event-save').click();
  expect((await saved).status()).toBe(200);

  const { data } = await db.from('events').select('flyer_url').in('id', [...a.ids, ...b.ids]);
  expect(data!.map((r) => r.flyer_url)).toEqual([flyer('new'), flyer('new'), flyer('new')]);
});

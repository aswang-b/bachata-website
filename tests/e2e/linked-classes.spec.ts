import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, seedLink, seedSignup, sweepTestData, testTitle, track, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { bearer } from './support/admin';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

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

// ---- The registration form and what's saved (classes form: no guidelines step) ----

const classFields = (picks: Seeded[], first: string) => ({
  registration_type: 'group',
  class: picks.map((p) => p.title).join('; '),
  payment_method: 'cash',
  class_selections: JSON.stringify(picks.map((p) => ({ key: p.key, title: p.title, label: '', mode: 'whole' }))),
  dancers: JSON.stringify([{ firstName: `ZZZ${first}`, lastName: RUN_ID, role: 'leader', phone: '6085550100', email: '' }]),
});
const savedRows = async (submissionId: string) =>
  (await db.from('class_registrations').select('series_key, price, class_label').eq('submission_id', submissionId).is('deleted_at', null)).data ?? [];
const submissionOf = (location: string | undefined) => new URL(location ?? '', 'http://x').searchParams.get('id')!;

test('includes: the subtotal shows the included class the same whether or not it was picked, and only the bigger one is saved', async ({ page }) => {
  const combo = await seedEvent({ name: 'Form Combo', priceWhole: 160, occurrences: 2, dayOffset: 60 });
  const base = await seedEvent({ name: 'Form Base', priceWhole: 85, priceDropIn: 25, occurrences: 2, dayOffset: 60 });
  await seedLink(combo, base, { kind: 'a_includes_b' });

  await page.goto('/register');
  // Picked on its own, the bigger class already shows what it includes.
  await selectSeries(page, combo.key);
  await expect(page.locator('.included-line')).toContainText(`Includes ${base.title}`);
  const shownAlone = await page.locator('#subtotal-row').innerText();
  await page.locator(`.series-item[data-key="${combo.key}"] .series-toggle-btn`).click();
  // Picked the other way round (the included one first), it ends up exactly the same.
  await selectSeries(page, base.key);
  await page.locator(`.series-item[data-key="${combo.key}"] .series-toggle-btn`).click();
  await expect.poll(() => page.locator('#subtotal-row').innerText()).toBe(shownAlone);
  // The base class was folded in: not a separate pick, shown as included, and not charged.
  await expect(page.locator(`.series-item[data-key="${base.key}"]`)).toHaveAttribute('data-selected', 'false');
  await expect(page.locator(`.series-item[data-key="${base.key}"] .series-included-badge`)).toHaveText(`Included with ${combo.title}`);
  await expect(page.locator('#subtotal-value')).toHaveText('$160');
  await expect(page.locator('.included-line')).toContainText(`Includes ${base.title}`);
  await expect(page.locator('.link-note-info')).toHaveText(`${base.title} is included with ${combo.title}, so you won't be charged for it twice.`);

  await fillDancer(page, 0, { first: 'Combo', role: 'leader' });
  await payCash(page);
  await submitRegistration(page);
  await expect(page).toHaveURL(/\/register\/confirmation/);
  const rows = await savedRows(confirmationId(page.url())!);
  // Only what they bought: no $0 row for the included class (its headcount comes from the link).
  expect(rows).toEqual([expect.objectContaining({ series_key: combo.key, price: 160 })]);
});

test('includes: a sign-up sent with both (an old tab) saves only the bigger class; an admin can still put them on the other one alone', async ({ request, admin }) => {
  const combo = await seedEvent({ name: 'Stale Combo', priceWhole: 160, dayOffset: 61 });
  const base = await seedEvent({ name: 'Stale Base', priceWhole: 85, dayOffset: 61 });
  await seedLink(combo, base, { kind: 'a_includes_b' });

  const res = await postForm(request, '/api/submit-intake', classFields([base, combo], 'Stale'));
  expect(res.status()).toBe(303);
  const submissionId = submissionOf(res.headers().location);
  const rows = await savedRows(submissionId);
  expect(rows).toEqual([expect.objectContaining({ series_key: combo.key, price: 160 })]);

  // The admin switches the dancer to just the base class: it's paid for again, on its own.
  const holderId = `e2e-link-${RUN_ID}`;
  expect((await request.post('/api/admin/acquire-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } })).ok()).toBe(true);
  try {
    const edit = await request.post('/api/admin/edit-signup', {
      headers: bearer(admin),
      data: {
        action: 'update',
        holderId,
        submissionId,
        dancerIndex: 0,
        firstName: 'ZZZStale',
        lastName: RUN_ID,
        email: '',
        phone: '6085550100',
        role: 'leader',
        paymentMethod: 'cash',
        paid: false,
        classSelections: [{ key: base.key, title: base.title, label: '', mode: 'whole' }],
      },
    });
    expect(edit.status(), await edit.text()).toBe(200);
  } finally {
    await request.post('/api/admin/release-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } });
  }
  const after = await savedRows(submissionId);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ series_key: base.key, price: 85 });
});

test('headcount: sign-ups for the bigger class fill the included one (shown full, and enforced), unless that box is unticked', async ({ request }) => {
  const combo = await seedEvent({ name: 'Count Combo', priceWhole: 160, dayOffset: 63 });
  const base = await seedEvent({ name: 'Count Base', priceWhole: 85, capacity: 1, showCapacity: true, dayOffset: 63 });
  await seedLink(combo, base, { kind: 'a_includes_b' });

  expect((await postForm(request, '/api/submit-intake', classFields([combo], 'CountA'))).status()).toBe(303);
  // The one spot is taken by the bigger class's dancer: the form shows it full...
  const form = await (await request.get('/register')).text();
  expect(form).toMatch(new RegExp(`data-key="${base.key}"[\\s\\S]*?Full`));
  // ...and the server refuses a sign-up for it on its own, and another for the bigger class.
  const alone = await postForm(request, '/api/submit-intake', classFields([base], 'CountB'));
  expect(alone.status()).toBe(400);
  expect(await alone.text()).toContain('full');
  expect((await postForm(request, '/api/submit-intake', classFields([combo], 'CountC'))).status()).toBe(400);

  // Not counting headcount: the included class has its own spot again.
  await db.from('event_link_rules').update({ count_headcount: false }).or(`key_a.eq.${combo.key},key_b.eq.${combo.key}`);
  expect((await postForm(request, '/api/submit-intake', classFields([base], 'CountD'))).status()).toBe(303);
});

test('cannot take both: a soft warning with a one-click remove; submitting anyway saves both and flags it for the admin', async ({ page }) => {
  const a = await seedEvent({ name: 'Either A', priceWhole: 45, dayOffset: 62 });
  const b = await seedEvent({ name: 'Either B', priceWhole: 45, dayOffset: 62 });
  await seedLink(a, b, { kind: 'exclusive', reason: 'They run at the same time.' });

  await page.goto('/register');
  await selectSeries(page, a.key);
  await selectSeries(page, b.key);
  const warning = page.locator('.link-note-warn');
  await expect(warning).toContainText('They run at the same time. Double-check before you submit.');
  await warning.locator('.link-note-remove').click();
  await expect(page.locator(`.series-item[data-key="${b.key}"]`)).toHaveAttribute('data-selected', 'false');
  await expect(warning).toHaveCount(0);

  // Picked again and submitted anyway: nothing blocks it.
  await selectSeries(page, b.key);
  await expect(page.locator('#subtotal-value')).toHaveText('$90');
  await fillDancer(page, 0, { first: 'Either', role: 'follower' });
  await payCash(page);
  await submitRegistration(page);
  await expect(page).toHaveURL(/\/register\/confirmation/);
  const submissionId = confirmationId(page.url())!;
  expect(await savedRows(submissionId)).toHaveLength(2);
  const { data: flagged } = await db.from('site_errors').select('kind, message, status').eq('kind', 'link_rule').like('message', `%ZZZEither ${RUN_ID}%`);
  expect(flagged).toHaveLength(1);
  expect(flagged![0].message).toContain(a.title);
  expect(flagged![0].message).toContain(b.title);
});

// ---- Editor tabs: one per linked class ----

const tab = (page: Page, s: Seeded) => page.locator('.event-tab', { hasText: s.title });
const closeDialog = (page: Page) => page.locator('[data-error-close]').click();

test('linked classes open as tabs that keep their changes; Save all saves each one', async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Tab A', type: 'event', priceWhole: 40, dayOffset: 80 });
  const b = await seedEvent({ name: 'Tab B', type: 'event', priceWhole: 15, dayOffset: 80 });
  await seedLink(a, b);

  await openEditor(page, a);
  await expect(page.locator('.event-tab')).toHaveCount(2);
  await expect(page.locator('#modal-heading')).toBeHidden();
  await expect(tab(page, a)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#event-save-all')).toBeVisible();

  // A change on A, then over to B: A keeps it (and is marked), B shows its own.
  await page.locator('#event-price-whole-series').fill('42');
  await expect(tab(page, a).locator('.event-tab-dot')).toBeVisible();
  await tab(page, b).click();
  await expect(page.locator('#event-title')).toHaveValue(b.title);
  await expect(page.locator('#event-price-whole-series')).toHaveValue('15');
  await page.locator('#event-location').fill('ZZZ Tab B Hall');
  await tab(page, a).click();
  await expect(page.locator('#event-price-whole-series')).toHaveValue('42');
  await expect(tab(page, b).locator('.event-tab-dot')).toBeVisible();

  // The Linked section's Open goes to that tab.
  await page.locator('.event-nav-btn[data-section="linked"]').click();
  await page.locator('.linked-open-btn').click();
  await expect(tab(page, b)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#event-location')).toHaveValue('ZZZ Tab B Hall');

  // Save all: both saved (Google is off for the test server, so one "not synced" dialog lists both).
  await page.locator('#event-save-all').click();
  await expect(page.getByText('Saved, but Google Calendar sync failed')).toBeVisible();
  const { data } = await db.from('events').select('id, price_whole_series, location').in('id', [a.ids[0], b.ids[0]]);
  expect(data!.find((r) => r.id === a.ids[0])!.price_whole_series).toBe(42);
  expect(data!.find((r) => r.id === b.ids[0])!.location).toBe('ZZZ Tab B Hall');
});

test("Save saves only the open tab and keeps the editor open for the others' changes; closing asks before discarding", async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Solo A', type: 'event', priceWhole: 40, dayOffset: 81 });
  const b = await seedEvent({ name: 'Solo B', type: 'event', priceWhole: 15, dayOffset: 81 });
  await seedLink(a, b);

  await openEditor(page, a);
  await page.locator('#event-price-whole-series').fill('44');
  await tab(page, b).click();
  await page.locator('#event-price-whole-series').fill('16');
  await page.locator('#event-save').click();
  await expect(page.getByText('Saved, but Google Calendar sync failed')).toBeVisible();
  await closeDialog(page);

  // B is saved and starts over clean; A still has its unsaved change.
  await expect(page.locator('#event-modal')).toBeVisible();
  await expect(tab(page, b)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, b).locator('.event-tab-dot')).toBeHidden();
  await expect(tab(page, a).locator('.event-tab-dot')).toBeVisible();
  const prices = async () => (await db.from('events').select('id, price_whole_series').in('id', [a.ids[0], b.ids[0]])).data ?? [];
  expect((await prices()).find((r) => r.id === b.ids[0])!.price_whole_series).toBe(16);
  expect((await prices()).find((r) => r.id === a.ids[0])!.price_whole_series).toBe(40);

  // Closing with A's change unsaved asks first; declining keeps the editor open.
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#event-close').click();
  await expect(page.locator('#event-modal')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.locator('#event-close').click();
  await expect(page.locator('#event-modal')).toBeHidden();
  expect((await prices()).find((r) => r.id === a.ids[0])!.price_whole_series).toBe(40);
});

test('a class that is not linked has no tabs', async ({ page, adminPage }) => {
  void adminPage;
  const lone = await seedEvent({ name: 'No Tabs', dayOffset: 82 });
  await openEditor(page, lone);
  await expect(page.locator('#event-tabs')).toBeHidden();
  await expect(page.locator('#modal-heading')).toBeVisible();
  await expect(page.locator('#event-save-all')).toBeHidden();
});

test("the Event Registration tab lists an included event in its filter and counts the bigger event's sign-ups, even after a rename", async ({ page, adminPage }) => {
  void adminPage;
  const workshop = await seedEvent({ name: 'Count Workshop', type: 'event', priceWhole: 20, dayOffset: 64 });
  const practica = await seedEvent({ name: 'Count Practica', type: 'event', priceWhole: 10, dayOffset: 64 });
  await seedLink(workshop, practica, { kind: 'a_includes_b' });
  await seedSignup(workshop, [{ first: 'CountWorkshopper' }], 'events');
  // Renamed after the sign-up, which keeps the old title.
  await db.from('events').update({ title: `${workshop.title} Renamed` }).in('id', workshop.ids);

  await page.goto('/admin/analytics');
  await page.locator('.tab-btn[data-tab="event-registration"]').click();
  await page.locator('#event-registrations-event-filter').selectOption(practica.title);
  await expect(page.locator('#event-registrations-count')).toHaveText(`0 results · +1 from ${workshop.title} Renamed`);
});


// ---- Review fixes: Drop-Ins, admin edits, flyers, Undo, transitive rules, headcount ----

const pick = (s: Seeded, mode: 'whole' | 'dropin', occurrenceEventId: string | null = null) => ({ key: s.key, title: s.title, label: '', mode, occurrenceEventId });
const submitPicks = async (request: Parameters<typeof postForm>[0], picks: ReturnType<typeof pick>[], first: string) => {
  const res = await postForm(request, '/api/submit-intake', {
    ...classFields([], first),
    class: picks.map((p) => p.title).join('; '),
    class_selections: JSON.stringify(picks),
  });
  expect(res.status(), await res.text()).toBe(303);
  return savedRows(submissionOf(res.headers().location));
};

// Adds `extra` to `inGroupOf`'s linked set, with `from` including `to`.
async function linkThird(inGroupOf: Seeded, extra: Seeded, from: Seeded, to: Seeded) {
  const { data: group } = await db.from('event_links').select('link_group_id').eq('series_key', inGroupOf.key).single();
  await db.from('event_links').upsert({ series_key: extra.key, link_group_id: group!.link_group_id });
  const [keyA, keyB] = [from.key, to.key].sort();
  await db.from('event_link_rules').upsert({ key_a: keyA, key_b: keyB, kind: keyA === from.key ? 'a_includes_b' : 'b_includes_a', reason: null });
}

test('includes: a Drop-In of the bigger class only covers the included class on that same day', async ({ page, request }) => {
  const combo = await seedEvent({ name: 'Day Combo', priceWhole: 160, priceDropIn: 40, occurrences: 2, dayOffset: 70 });
  const base = await seedEvent({ name: 'Day Base', priceWhole: 85, priceDropIn: 25, occurrences: 2, dayOffset: 70 });
  await seedLink(combo, base, { kind: 'a_includes_b' });

  // A whole series of the included class stays its own, paid sign-up (it was once dropped unpaid).
  const withWhole = await submitPicks(request, [pick(combo, 'dropin', combo.ids[0]), pick(base, 'whole')], 'DayWhole');
  expect(withWhole).toHaveLength(2);
  expect(withWhole).toEqual(
    expect.arrayContaining([expect.objectContaining({ series_key: combo.key, price: 40 }), expect.objectContaining({ series_key: base.key, price: 85 })])
  );
  // A Drop-In of it on another day too.
  expect(await submitPicks(request, [pick(combo, 'dropin', combo.ids[0]), pick(base, 'dropin', base.ids[1])], 'DayOther')).toHaveLength(2);
  // On the same day it's covered.
  expect(await submitPicks(request, [pick(combo, 'dropin', combo.ids[0]), pick(base, 'dropin', base.ids[0])], 'DaySame')).toEqual([
    expect.objectContaining({ series_key: combo.key, price: 40 }),
  ]);

  // The form agrees: the base class picked next to a Drop-In of the combo stays picked.
  await page.goto('/register');
  const comboCard = await selectSeries(page, combo.key);
  await comboCard.locator('.series-mode-radio[value="dropin"]').check();
  await comboCard.locator(`.occurrence-btn[data-event-id="${combo.ids[0]}"]`).click();
  await selectSeries(page, base.key);
  await expect(page.locator(`.series-item[data-key="${base.key}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('#subtotal-value')).toHaveText('$125');
});

test("includes: an admin adding a class another of the dancer's classes includes gets an error, and nothing changes", async ({ request, admin }) => {
  const combo = await seedEvent({ name: 'Edit Combo', priceWhole: 160, dayOffset: 71 });
  const base = await seedEvent({ name: 'Edit Base', priceWhole: 85, dayOffset: 71 });
  await seedLink(combo, base, { kind: 'a_includes_b' });
  const res = await postForm(request, '/api/submit-intake', classFields([combo], 'EditAdd'));
  const submissionId = submissionOf(res.headers().location);

  const holderId = `e2e-link-add-${RUN_ID}`;
  expect((await request.post('/api/admin/acquire-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } })).ok()).toBe(true);
  try {
    const edit = await request.post('/api/admin/edit-signup', {
      headers: bearer(admin),
      data: {
        action: 'update',
        holderId,
        submissionId,
        dancerIndex: 0,
        firstName: 'ZZZEditAdd',
        lastName: RUN_ID,
        email: '',
        phone: '6085550100',
        role: 'leader',
        paymentMethod: 'cash',
        paid: false,
        classSelections: [pick(combo, 'whole'), pick(base, 'whole')],
      },
    });
    expect(edit.status()).toBe(400);
    expect((await edit.json()).error).toBe(`${base.title} is already included with ${combo.title}, so it can't be added separately. Remove one of them and save again.`);
  } finally {
    await request.post('/api/admin/release-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } });
  }
  expect(await savedRows(submissionId)).toEqual([expect.objectContaining({ series_key: combo.key, price: 160 })]);
});

test('a flyer set while editing one week goes on every week of the series (it once stayed on that week)', async ({ request, admin }) => {
  const s = await seedEvent({ name: 'Week Flyer', occurrences: 2, dayOffset: 72, flyerUrl: flyer('week-old') });
  const { data: row } = await db.from('events').select('title, start_time, end_time').eq('id', s.ids[1]).single();
  const res = await request.post('/api/admin/update-event', {
    headers: bearer(admin),
    data: { id: s.ids[1], title: row!.title, startTime: row!.start_time, endTime: row!.end_time, priceWholeSeries: 50, flyerUrl: flyer('week-new'), applyToSeries: false },
  });
  expect(res.status(), await res.text()).toBe(200);
  const { data } = await db.from('events').select('flyer_url').in('id', s.ids);
  expect(data!.map((r) => r.flyer_url)).toEqual([flyer('week-new'), flyer('week-new')]);
});

test("linked classes share one flyer in the editor: a tab's older draft can't put the old one back on Save all", async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Draft Flyer A', type: 'event', priceWhole: 40, dayOffset: 81, flyerUrl: flyer('draft-old') });
  const b = await seedEvent({ name: 'Draft Flyer B', type: 'event', priceWhole: 15, dayOffset: 82, flyerUrl: flyer('draft-old') });
  await seedLink(a, b);

  await openEditor(page, a);
  await expect(page.locator('#event-flyer-shared')).toHaveText(`Also used by ${b.title}.`);
  // B gets a draft while it still shows the old flyer.
  await tab(page, b).click();
  await page.locator('#event-location').fill('ZZZ Draft Hall');
  await tab(page, a).click();
  await page.locator('.event-nav-btn[data-section="homepage"]').click();
  await page.locator('#event-flyer-remove').click();
  // Back on B, the flyer shows as removed there too.
  await tab(page, b).click();
  await expect(page.locator('#event-flyer-remove')).toBeHidden();
  await page.locator('#event-save-all').click();
  await expect(page.getByText('Saved, but Google Calendar sync failed')).toBeVisible();
  const { data } = await db.from('events').select('flyer_url, location').in('id', [a.ids[0], b.ids[0]]);
  expect(data!.map((r) => r.flyer_url)).toEqual([null, null]);
  expect(data!.map((r) => r.location)).toContain('ZZZ Draft Hall');
});

test("Undo still brings back the text a tab's save replaced after switching tabs and back", async ({ page, adminPage }) => {
  void adminPage;
  const a = await seedEvent({ name: 'Undo A', type: 'event', priceWhole: 40, dayOffset: 83, description: '<div>ZZZ before</div>' });
  const b = await seedEvent({ name: 'Undo B', type: 'event', priceWhole: 15, dayOffset: 83 });
  await seedLink(a, b);

  await openEditor(page, a);
  await page.locator('#event-description').fill('ZZZ after');
  await tab(page, b).click();
  await tab(page, a).click();
  await expect(page.locator('#event-description')).toHaveText('ZZZ after');
  await page.locator('#event-save').click();
  await expect(page.getByText('Saved, but Google Calendar sync failed')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(`rich-prev:event:${key}:description`), a.key)).toBe('<div>ZZZ before</div>');
});

test('includes through a class that is not on the page fold the same in the form as on the server', async ({ page }) => {
  const top = await seedEvent({ name: 'Chain Top', priceWhole: 100, dayOffset: 73 });
  const middle = await seedEvent({ name: 'Chain Middle', priceWhole: 60, dayOffset: 73 });
  const bottom = await seedEvent({ name: 'Chain Bottom', priceWhole: 30, dayOffset: 73 });
  await seedLink(top, middle, { kind: 'a_includes_b' });
  await linkThird(top, bottom, middle, bottom);
  // The middle class is over, so it isn't on the form.
  const past = Date.now() - 2 * 86400000;
  await db.from('events').update({ start_time: new Date(past).toISOString(), end_time: new Date(past + 3600000).toISOString() }).in('id', middle.ids);

  await page.goto('/register');
  await expect(page.locator(`.series-item[data-key="${middle.key}"]`)).toHaveCount(0);
  await selectSeries(page, top.key);
  await page.locator(`.series-item[data-key="${bottom.key}"] .series-toggle-btn`).click();
  await expect(page.locator(`.series-item[data-key="${bottom.key}"]`)).toHaveAttribute('data-selected', 'false');
  await expect(page.locator(`.series-item[data-key="${bottom.key}"] .series-included-badge`)).toHaveText(`Included with ${top.title}`);
  await expect(page.locator('#subtotal-value')).toHaveText('$100');
});

test('the Event Registration tab\'s "+N from" leaves out an including event that doesn\'t overlap in time, and counts dancers', async ({ page, adminPage }) => {
  void adminPage;
  const gala = await seedEvent({ name: 'Overlap Gala', type: 'event', priceWhole: 20, dayOffset: 66 });
  const after = await seedEvent({ name: 'Overlap After', type: 'event', priceWhole: 10, dayOffset: 66 });
  const later = await seedEvent({ name: 'Overlap Later', type: 'event', priceWhole: 10, dayOffset: 67 });
  await seedLink(gala, after, { kind: 'a_includes_b' });
  await linkThird(gala, later, gala, later);
  await seedSignup(gala, [{ first: 'OverlapOne' }, { first: 'OverlapTwo' }], 'events');

  await page.goto('/admin/analytics');
  await page.locator('.tab-btn[data-tab="event-registration"]').click();
  await page.locator('#event-registrations-event-filter').selectOption(after.title);
  await expect(page.locator('#event-registrations-count')).toHaveText(`0 results · +2 from ${gala.title}`);
  // The later event doesn't overlap the gala, so nothing counts toward it: it isn't even offered as a filter.
  await expect(page.locator('#event-registrations-event-filter option', { hasText: later.title })).toHaveCount(0);
});

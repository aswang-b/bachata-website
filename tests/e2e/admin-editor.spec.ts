import { test, expect } from './support/fixtures';
import { db, seedEvent, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { bearer } from './support/admin';
import type { Page } from '@playwright/test';

// The event editor, with Google Calendar off for the test server: saves only
// write the database (the editor then shows its "not synced" dialog).
let klass: Seeded;
let event: Seeded;

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Editor Class', capacity: 20, showCapacity: true });
  event = await seedEvent({ name: 'Editor Event', type: 'event', capacity: 30, dayOffset: 1 });
});

async function openEditor(page: Page, s: Seeded) {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  const d = new Date(data!.start_time);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  await page.goto(`/calendar?month=${month}`);
  // Clicked as soon as the admin controls appear — before the admin copy of the
  // events may have loaded, which once opened an editor with blank capacities.
  await expect(page.locator('#add-event-btn')).toBeVisible();
  await page.locator('.event-banner', { hasText: s.title }).first().click();
  await page.locator('#detail-edit-btn').click();
  await expect(page.locator('#event-modal')).toBeVisible();
  await expect(page.locator('#event-title')).toHaveValue(s.title);
}

async function save(page: Page) {
  const response = page.waitForResponse((r) => /\/api\/admin\/(update|create)-event/.test(r.url()));
  await page.locator('#event-save').click();
  const res = await response;
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body.calendarSyncSkipped, 'Google must be off for the test server').toBe(true);
  // Google is off, so a successful save ends with the copyable "not synced" dialog.
  await expect(page.getByText('Saved, but Google Calendar sync failed')).toBeVisible();
}

test('class capacity: the toggle swaps a single cap for Leader/Follower caps, and both sets are kept', async ({ page, adminPage }) => {
  void adminPage;
  await openEditor(page, klass);
  const toggle = page.locator('#event-capacity-by-role');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#event-capacity')).toHaveValue('20');
  await expect(page.locator('#event-capacity-roles')).toBeHidden();

  await toggle.click();
  await expect(page.locator('#event-capacity-general')).toBeHidden();
  await page.locator('#event-leader-capacity').fill('6');
  await page.locator('#event-follower-capacity').fill('7');
  await save(page);

  const { data } = await db.from('events').select('capacity, capacity_by_role, leader_capacity, follower_capacity, show_capacity').eq('id', klass.ids[0]).single();
  expect(data).toEqual({ capacity: 20, capacity_by_role: true, leader_capacity: 6, follower_capacity: 7, show_capacity: true });

  // Reopened, the editor shows the role fields again.
  await openEditor(page, klass);
  await expect(page.locator('#event-capacity-by-role')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#event-leader-capacity')).toHaveValue('6');
});

test('events have no role caps: the toggle is hidden and a save always uses the single cap', async ({ page, adminPage }) => {
  void adminPage;
  await db.from('events').update({ capacity_by_role: true, leader_capacity: 3 }).eq('id', event.ids[0]);
  await openEditor(page, event);
  await expect(page.locator('#event-capacity-by-role-row')).toBeHidden();
  await expect(page.locator('#event-capacity')).toBeVisible();
  await save(page);
  const { data } = await db.from('events').select('capacity, capacity_by_role').eq('id', event.ids[0]).single();
  expect(data).toEqual({ capacity: 30, capacity_by_role: false });
});

test('an event can end at midnight (the next day), but not at its start time', async ({ page, adminPage }) => {
  void adminPage;
  await openEditor(page, event);
  await page.locator('#event-start-time').fill('20:00');
  await page.locator('#event-end-time').fill('20:00');
  // alert() blocks the click until it's answered, so answer it from a handler.
  let alertText = '';
  page.once('dialog', (d) => {
    alertText = d.message();
    void d.accept();
  });
  await page.locator('#event-save').click();
  await expect.poll(() => alertText).toContain('same as the start time');

  await page.locator('#event-end-time').fill('00:00');
  await save(page);
  const { data } = await db.from('events').select('start_time, end_time').eq('id', event.ids[0]).single();
  expect(Date.parse(data!.end_time) - Date.parse(data!.start_time)).toBe(4 * 60 * 60 * 1000);
});

test('the admin calendar feed labels spots, marking ones hidden from the public', async ({ request, admin }) => {
  const all = await (await request.get('/api/admin/all-events', { headers: bearer(admin) })).json();
  const row = all.events.find((e: { id: string }) => e.id === event.ids[0]);
  expect(row.spots_label).toBe('30 spots remaining');
  expect(row.spots_admin_only).toBe(true);
});

test.describe('Guidelines tab', () => {
  let original = '';
  test.beforeAll(async () => {
    const { data } = await db.from('community_guidelines').select('body').eq('id', true).maybeSingle();
    original = data?.body ?? '';
  });
  test.afterAll(async () => {
    await db.from('community_guidelines').upsert({ id: true, body: original, updated_at: new Date().toISOString() });
  });

  test('edits and saves the guidelines, with headings, and strips anything unsafe', async ({ page, adminPage }) => {
    void adminPage;
    // Wait for the saved guidelines to load into the editor, or they'd overwrite what's typed next.
    const loaded = page.waitForResponse((r) => r.url().includes('/api/admin/guidelines') && r.request().method() === 'GET');
    await page.goto('/admin');
    await loaded;
    await page.locator('.admin-tab-btn[data-tab="guidelines"]').click();
    const editor = page.locator('#guidelines-editor');
    await expect(editor).toBeVisible();
    await editor.evaluate((el, run) => {
      el.innerHTML = `<div>ZZZ rules ${run}</div><div>Be kind</div><img src=x onerror="alert(1)">`;
    }, RUN_ID);
    // Make "Be kind" a heading with the toolbar button.
    await editor.locator('div', { hasText: 'Be kind' }).click();
    await page.locator('#guidelines-heading-btn').click();
    await page.locator('#guidelines-save').click();
    await expect(page.locator('#guidelines-status')).toHaveText('Saved.');

    const { data } = await db.from('community_guidelines').select('body').eq('id', true).single();
    expect(data!.body).toContain('<h3>Be kind</h3>');
    expect(data!.body).toContain(`ZZZ rules ${RUN_ID}`);
    expect(data!.body).not.toMatch(/img|onerror/);

    await page.reload();
    await page.locator('.admin-tab-btn[data-tab="guidelines"]').click();
    await expect(page.locator('#guidelines-editor h3')).toHaveText('Be kind');
  });
});

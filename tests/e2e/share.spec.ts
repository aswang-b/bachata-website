import { test, expect } from './support/fixtures';
import { db, seedEvent, siteZone, sweepTestData, type Seeded } from './support/db';
import { env } from './support/env';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Share buttons (scripts/share.ts, calendar/editor/shareFlyer.ts). Playwright
// can't open a real share sheet, so navigator.share, canShare and the clipboard
// are replaced before the page loads and every call is recorded.
let klass: Seeded;
let withFlyer: Seeded;
let past: Seeded;

// 1x1 JPEG.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

test.beforeAll(async () => {
  klass = await seedEvent({ name: 'Share Class', priceDropIn: 15, dayOffset: 60 });
  withFlyer = await seedEvent({
    name: 'Share Flyer',
    flyerUrl: `${env('SUPABASE_URL')}/storage/v1/object/public/event-images/zzz-share_1080x1440.jpg`,
    city: 'Santa Fe',
    state: 'NM',
    dayOffset: 61,
  });
  past = await seedEvent({ name: 'Share Past', dayOffset: 62 });
  const { error } = await db.from('events').update({ start_time: '2020-01-01T01:00:00Z', end_time: '2020-01-01T02:00:00Z' }).eq('id', past.ids[0]);
  if (error) throw new Error(error.message);
});

interface Stubs {
  share?: boolean;
  canShare?: boolean;
  clipboard?: boolean;
}

// Replaces the browser's sharing before any page script runs; calls land in window.__calls.
async function stubSharing(page: Page, { share = true, canShare = true, clipboard = true }: Stubs = {}) {
  await page.addInitScript(
    ([hasShare, canShareFiles, hasClipboard]) => {
      const calls: { api: string; title?: string; text?: string; url?: string; files?: { name: string; type: string; size: number }[] }[] = [];
      (window as unknown as { __calls: typeof calls }).__calls = calls;
      const define = (name: string, value: unknown) => Object.defineProperty(navigator, name, { value, configurable: true });
      define(
        'share',
        hasShare
          ? async (d: { title?: string; text?: string; url?: string; files?: File[] }) => {
              calls.push({ api: 'share', title: d.title, text: d.text, url: d.url, files: d.files?.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
            }
          : undefined
      );
      define('canShare', (d: { files?: File[] }) => (d.files ? canShareFiles : true));
      define('clipboard', hasClipboard ? { writeText: async (t: string) => void calls.push({ api: 'copy', text: t }) } : undefined);
    },
    [share, canShare, clipboard] as const
  );
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls) as Promise<Record<string, any>[]>;
const row = (page: Page, s: Seeded) => page.locator(`[data-offering-key="${s.key}"]`);

test("a dancer's Share passes on the class's name, schedule and its own link", async ({ page }) => {
  await stubSharing(page);
  await page.goto('/');
  const button = row(page, klass).locator('button[data-share]');
  await expect(button).toHaveText('Share');
  await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await button.click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  const [call] = await calls(page);
  expect(call.api).toBe('share');
  expect(call.title).toBe(klass.title);
  expect(call.text).toMatch(new RegExp(`^${klass.title} · .+`));
  expect(call.url).toBe(`${new URL(page.url()).origin}/register?series=${encodeURIComponent(klass.key)}`);
  expect(Object.keys(call).filter((k) => call[k] !== undefined).sort()).toEqual(['api', 'text', 'title', 'url']);
  // Nothing is said when the sheet took it.
  await expect(row(page, klass).locator('[data-share-status]')).toHaveText('');
});

test('the Share control is quiet: 44px to tap, and Register does not move or change', async ({ page }) => {
  await page.goto('/');
  const register = row(page, klass).locator('a', { hasText: 'Register' });
  const box = await register.boundingBox();
  const share = row(page, klass).locator('button[data-share]');
  await expect(share).toBeVisible();
  // The tap area (hit-44's ::after on touch screens) is checked by class; the visible control stays small.
  await expect(share).toHaveClass(/hit-44/);
  const after = await register.boundingBox();
  expect(after).toEqual(box);
  // It sits below the Register button, never beside the flyer or inside the price row.
  const s = await share.boundingBox();
  expect(s!.y).toBeGreaterThan(box!.y + box!.height - 1);
});

test('without a share sheet, Share copies the link and says so for a moment', async ({ page }) => {
  await stubSharing(page, { share: false });
  await page.goto('/');
  await row(page, klass).locator('button[data-share]').click();
  const status = row(page, klass).locator('[data-share-status]');
  await expect(status).toHaveText('Link copied');
  await expect(status).toHaveAttribute('role', 'status');
  const [call] = await calls(page);
  expect(call).toEqual({ api: 'copy', text: `${new URL(page.url()).origin}/register?series=${encodeURIComponent(klass.key)}` });
  await expect(status).toHaveText('', { timeout: 6000 });
});

test('with neither a share sheet nor a clipboard, the link is shown to copy by hand', async ({ page }) => {
  await stubSharing(page, { share: false, clipboard: false });
  await page.goto('/');
  await row(page, klass).locator('button[data-share]').click();
  const field = row(page, klass).locator('input[data-share-manual]');
  await expect(field).toHaveValue(`${new URL(page.url()).origin}/register?series=${encodeURIComponent(klass.key)}`);
});

test('a class that has passed has no Share button', async ({ page }) => {
  await page.goto('/');
  await expect(row(page, klass)).toBeVisible();
  await expect(row(page, past)).toHaveCount(0);
  await expect(page.locator(`button[data-share][data-share-key="${past.key}"]`)).toHaveCount(0);
});

async function openDetails(page: Page, s: Seeded, admin = true) {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: await siteZone(), year: 'numeric', month: '2-digit' }).format(new Date(data!.start_time));
  await page.goto(`/calendar?month=${month}`);
  // The panel shows its admin buttons only if admin mode is on when a class is opened.
  if (admin) await expect(page.locator('#add-event-btn')).toBeVisible();
  await page.locator('.event-banner', { hasText: s.title }).first().click();
  await expect(page.locator('#detail-title')).toContainText(s.title);
}

test('an admin\'s Share flyer copies the caption first, then shares the picture with it', async ({ page, adminPage }) => {
  void adminPage;
  let flyerRequests = 0;
  await page.route('**/storage/v1/render/image/**', (route) => {
    flyerRequests++;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG, headers: { 'access-control-allow-origin': '*' } });
  });
  await stubSharing(page);
  await openDetails(page, withFlyer);
  const button = page.locator('#detail-share-flyer-btn');
  await expect(button).toHaveText('Share flyer');
  await button.click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  const [copy, share] = await calls(page);
  expect(copy.api).toBe('copy');
  const lines = copy.text.split('\n');
  expect(lines[0]).toBe(withFlyer.title);
  expect(lines).toContain('ZZZ Test Studio · Santa Fe');
  expect(lines[lines.length - 1]).toBe(`${new URL(page.url()).origin}/register?series=${encodeURIComponent(withFlyer.key)}`);
  expect(share.api).toBe('share');
  expect(share.text).toBe(copy.text);
  expect(share.url).toBeUndefined();
  expect(share.files).toHaveLength(1);
  expect(share.files[0]).toMatchObject({ type: 'image/jpeg', name: expect.stringMatching(/\.jpg$/) });
  expect(flyerRequests).toBe(1);
  // The picture is fetched the way a link preview's is (width, quality).
  await expect(page.locator('#detail-share-flyer-status')).toHaveText('');
  await expect(button).toBeEnabled();
});

test('Share flyer says "Caption copied" and falls back to text and link when files cannot be shared', async ({ page, adminPage }) => {
  void adminPage;
  await page.route('**/storage/v1/render/image/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG, headers: { 'access-control-allow-origin': '*' } }));
  await stubSharing(page, { canShare: false, share: true });
  await openDetails(page, withFlyer);
  await page.locator('#detail-share-flyer-btn').click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  const [, share] = await calls(page);
  expect(share.files).toBeUndefined();
  expect(share.text).toContain(withFlyer.title);
  expect(share.url).toBe(`${new URL(page.url()).origin}/register?series=${encodeURIComponent(withFlyer.key)}`);
});

test('Share flyer with no share sheet leaves the caption copied and offers the flyer to download', async ({ page, adminPage }) => {
  void adminPage;
  await page.route('**/storage/v1/render/image/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG, headers: { 'access-control-allow-origin': '*' } }));
  await stubSharing(page, { share: false });
  await openDetails(page, withFlyer);
  await page.locator('#detail-share-flyer-btn').click();
  const status = page.locator('#detail-share-flyer-status');
  await expect(status).toContainText('Caption copied');
  await expect(status.locator('a[download]')).toHaveText('Download flyer');
});

test('a class with no flyer shares its caption and link only', async ({ page, adminPage }) => {
  void adminPage;
  await stubSharing(page);
  await openDetails(page, klass);
  await page.locator('#detail-share-flyer-btn').click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  const [copy, share] = await calls(page);
  expect(copy.text.split('\n')).toContain('Price: $50');
  expect(share.files).toBeUndefined();
});

test('a signed-out visitor has no Share flyer button', async ({ page }) => {
  await openDetails(page, withFlyer, false);
  await expect(page.locator('#detail-title')).toContainText(withFlyer.title);
  await expect(page.locator('#detail-share-flyer-btn')).toHaveCount(0);
});

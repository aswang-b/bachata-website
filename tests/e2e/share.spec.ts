import { test, expect } from './support/fixtures';
import { db, seedEvent, siteZone, sweepTestData, type Seeded } from './support/db';
import { env } from './support/env';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// The admin's Share flyer (calendar/editor/shareFlyer.ts, scripts/share.ts). Playwright
// can't open a real share sheet, so navigator.share, canShare and the clipboard
// are replaced before the page loads and every call is recorded.
let klass: Seeded;
let withFlyer: Seeded;

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

test('the homepage has no Share button for dancers, just Register', async ({ page }) => {
  await page.goto('/');
  await expect(row(page, klass).locator('a', { hasText: 'Register' })).toBeVisible();
  await expect(page.locator('button[data-share], [data-share-row]')).toHaveCount(0);
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

test('each tap on Share flyer lets go of the previous download address', async ({ page, adminPage }) => {
  void adminPage;
  await page.route('**/storage/v1/render/image/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG, headers: { 'access-control-allow-origin': '*' } }));
  await stubSharing(page, { share: false });
  // Records the page's blob addresses without changing what they do.
  await page.addInitScript(() => {
    const log = { created: [] as string[], revoked: [] as string[] };
    (window as unknown as { __urls: typeof log }).__urls = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const url = create(o);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      log.revoked.push(url);
      revoke(url);
    };
  });
  await openDetails(page, withFlyer);
  const link = page.locator('#detail-share-flyer-status a[download]');
  const urls = () => page.evaluate(() => (window as unknown as { __urls: { created: string[]; revoked: string[] } }).__urls);

  await page.locator('#detail-share-flyer-btn').click();
  await expect(link).toHaveText('Download flyer');
  const afterFirst = await urls();
  expect(afterFirst.created).toHaveLength(1);
  expect(afterFirst.revoked).toEqual([]);
  await expect(link).toHaveAttribute('href', afterFirst.created[0]);

  await page.locator('#detail-share-flyer-btn').click();
  await expect(link).toHaveAttribute('href', /^blob:/);
  await expect.poll(async () => (await urls()).created.length).toBe(2);
  const afterSecond = await urls();
  expect(afterSecond.created[1]).not.toBe(afterSecond.created[0]);
  // Only the newest is still held.
  expect(afterSecond.revoked).toEqual([afterSecond.created[0]]);
  await expect(link).toHaveAttribute('href', afterSecond.created[1]);
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

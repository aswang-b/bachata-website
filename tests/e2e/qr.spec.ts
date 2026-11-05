import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { test, expect } from './support/fixtures';
import { seedEvent, sweepTestData } from './support/db';
import { signInBrowser } from './support/admin';

// The door sign (/admin/qr). The test server fakes qr.dancewithb.fun and Venmo
// (E2E_FAKE_QR), so no real link is repointed and nobody is looked up; any
// username is "found" (with a made-up id) except "missing".
test.afterAll(sweepTestData);

const DANCE_WITH_B_VENMO = 'https://venmo.com/code?user_id=2024335518728192092';

// What a drawn code opens, read the way a phone would.
async function decode(canvas: Locator): Promise<string | null> {
  const dataUrl = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/png'));
  const { data, info } = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

async function pickClass(page: Page, title: string) {
  await page.locator('.class-item', { hasText: title }).locator('.class-select-btn').click();
}

test('the door sign: branded check-in link set up once and repointed, simple codes and Venmo codes that scan', async ({ page, adminPage }) => {
  void adminPage;
  const first = await seedEvent({ name: 'Door Sign A', priceDropIn: 15 });
  const second = await seedEvent({ name: 'Door Sign B', priceDropIn: 15 });

  // The old check-in QR address lands here.
  await page.goto('/admin/checkin-qr');
  await expect(page).toHaveURL(/\/admin\/qr$/);
  await expect(page.locator('#qr-admin')).toBeVisible();

  // Before setup the sign still works, with a plain code straight to check-in.
  const preview = page.locator('#sign-preview');
  await expect(preview).toContainText('Welcome to class!');
  await expect(page.locator('#sign-point')).toBeDisabled();

  // Setup: the site makes the short link; the (faked) generator's saved code is found.
  await page.locator('#tab-setup').click();
  await expect(page.locator('#setup-connection')).toContainText('Connected');
  if (await page.locator('#setup-create').isEnabled()) await page.locator('#setup-create').click();
  await expect(page.locator('#setup-link')).toContainText('qr.example.test/c/');
  await expect(page.locator('#setup-generator')).toHaveAttribute('href', /\?text=https%3A%2F%2Fqr\.example\.test%2Fc%2F/);
  await expect(page.locator('#setup-code option').first()).toContainText('Test branded code');
  const short = (await page.locator('#setup-link').textContent())!.split(' ')[0];

  // Pointing at a class: the branded code shows; its simple version opens the same short link.
  await page.locator('#tab-sign').click();
  await pickClass(page, first.title);
  await page.locator('#sign-point').click();
  await expect(page.locator('#sign-status')).toContainText(`now opens check-in for ${first.title}`);
  await expect(page.locator('#opens')).toContainText(first.title);
  await expect(preview.locator('.sign-code img')).toBeVisible();
  await preview.getByRole('button', { name: /Hard to scan/ }).click();
  expect(await decode(preview.locator('.sign-half').first().locator('canvas'))).toBe(short);
  await expect(preview).toContainText(first.title);

  // Dance with B's Venmo by default, with the code Venmo's own scanner reads.
  expect(await decode(preview.locator('.sign-half').nth(1).locator('canvas'))).toBe(DANCE_WITH_B_VENMO);
  await expect(preview).toContainText('@amumira · Dance with B');

  // Repointing soon after, somewhere else, asks first.
  await pickClass(page, first.title);
  await pickClass(page, second.title);
  await page.locator('#sign-point').click();
  await expect(page.locator('#sign-status')).toContainText(`It was pointed at ${first.title}`);
  await page.locator('#point-anyway').click();
  await expect(page.locator('#sign-status')).toContainText(`now opens check-in for ${second.title}`);

  // An artist: found by username, shown on the sign, remembered, then removed.
  await page.getByRole('radio', { name: /Someone else/ }).check();
  await page.locator('#venmo-username').fill('missing');
  await page.locator('#venmo-find').click();
  await expect(page.locator('#venmo-status')).toContainText('Venmo has no @missing');
  await page.locator('#venmo-username').fill('@lunamoves');
  await page.locator('#venmo-find').click();
  await expect(page.locator('#venmo-found')).toContainText('Test lunamoves');
  await page.locator('#venmo-label').fill('Luna');
  await expect(preview).toContainText('@lunamoves · Luna');
  expect(await decode(preview.locator('.sign-half').nth(1).locator('canvas'))).toBe('https://venmo.com/code?user_id=1234567890123456789');
  await page.locator('#venmo-remember').click();
  await expect(page.getByRole('radio', { name: /Luna/ })).toBeChecked();
  await page.locator('#tab-venmo').click();
  const luna = page.locator('.venmo-account', { hasText: '@lunamoves' });
  await luna.getByRole('button', { name: 'Remove' }).click();
  await expect(luna).toHaveCount(0);
  await page.locator('#tab-sign').click();
  await expect(page.getByRole('radio', { name: /Luna/ })).toHaveCount(0);

  // No Venmo code: just check-in.
  await page.getByRole('radio', { name: /No Venmo code/ }).check();
  await expect(preview.locator('.sign-half')).toHaveCount(1);
  await page.getByRole('radio', { name: /Dance with B/ }).check();

  // The sign downloads as a picture.
  const download = page.waitForEvent('download');
  await page.locator('#download-sign').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('door-sign.png');

  // Full screen, then closed.
  await page.locator('#show-full').click();
  await expect(page.locator('#full')).toBeVisible();
  await expect(page.locator('#full-sign .sign-code').first()).toBeVisible();
  await page.locator('#full-close').click();
  await expect(page.locator('#full')).toBeHidden();
});

test('on a phone, the full-screen sign shows one code at a time and the page never scrolls sideways', async ({ browser, adminSession }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  await signInBrowser(context, adminSession);
  const page = await context.newPage();
  await page.goto('/admin/qr');
  await expect(page.locator('#qr-admin')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.locator('#show-full').click();
  const halves = page.locator('#full-sign .sign-half');
  await expect(halves.first()).toBeVisible();
  await expect(halves.nth(1)).toBeHidden();
  await page.locator('#full-switch').getByRole('button', { name: 'Pay' }).click();
  await expect(halves.nth(1)).toBeVisible();
  await expect(halves.first()).toBeHidden();
  expect(await decode(halves.nth(1).locator('canvas'))).toBe(DANCE_WITH_B_VENMO);
  await context.close();
});

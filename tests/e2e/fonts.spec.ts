import { test, expect } from './support/fixtures';
import { sweepTestData } from './support/db';

// Nothing here seeds data; the sweep is for the suite's rule that every spec has one.
test.afterAll(sweepTestData);

// The fonts come from the site itself (src/styles/fonts.css), so no page asks Google for them.
const PAGES = ['/', '/calendar', '/register', '/admin'];

for (const path of PAGES) {
  test(`${path} makes no request to Google Fonts`, async ({ page }) => {
    const hosts: string[] = [];
    page.on('request', (req) => hosts.push(new URL(req.url()).hostname));
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(750);
    expect(hosts.filter((h) => /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(h))).toEqual([]);
  });
}

test('the site fonts load from the site itself, in the same families and weights as before', async ({ page, baseURL }) => {
  const fontFiles: string[] = [];
  page.on('response', (res) => {
    if (/\.woff2(\?|$)/.test(res.url())) fontFiles.push(res.url());
  });
  await page.goto('/register'); // a Poppins heading (700) on Inter body text
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const h1 = document.querySelector('h1')!;
    await Promise.all([document.fonts.load('400 16px Inter', 'Register'), document.fonts.load('700 30px Poppins', 'Register')]);
    return {
      body: getComputedStyle(document.body).fontFamily,
      h1: getComputedStyle(h1).fontFamily,
      h1Weight: getComputedStyle(h1).fontWeight,
      inter: document.fonts.check('400 16px Inter', 'Register'),
      poppins: document.fonts.check('700 30px Poppins', 'Register'),
    };
  });
  expect(result.body).toMatch(/^Inter,/);
  expect(result.h1).toMatch(/^Poppins,/);
  expect(result.h1Weight).toBe('700');
  expect(result.inter).toBe(true);
  expect(result.poppins).toBe(true);
  expect(fontFiles.length).toBeGreaterThan(0);
  for (const url of fontFiles) expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
});

test('the homepage heading and logo use the same families as before, and only the two first-screen fonts are preloaded', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
    logo: getComputedStyle(document.querySelector('#site-header a[href="/"]')!).fontFamily,
    logoWeight: getComputedStyle(document.querySelector('#site-header a[href="/"]')!).fontWeight,
    preloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => ({ type: l.getAttribute('type'), cross: l.hasAttribute('crossorigin'), href: l.getAttribute('href') })),
    poppins: document.fonts.check('800 20px Poppins', 'Dance with B'),
  }));
  expect(result.h1).toMatch(/^Inter,/); // the homepage's h1 is a small Inter line
  expect(result.logo).toMatch(/^Poppins,/);
  expect(result.logoWeight).toBe('800');
  expect(result.poppins).toBe(true);
  expect(result.preloads).toHaveLength(2);
  for (const p of result.preloads) {
    expect(p.type).toBe('font/woff2');
    expect(p.cross).toBe(true);
    expect(p.href).toMatch(/\.woff2/);
  }
});

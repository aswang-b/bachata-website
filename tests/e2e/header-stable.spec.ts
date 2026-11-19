import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { sweepTestData } from './support/db';
import { BUTTON_WIDTH, LINK_WIDTH, LOGO_WIDTH } from '../../src/lib/headerFit';

// Nothing here seeds data; the sweep is for the suite's rule that every spec has one.
test.afterAll(sweepTestData);

// The header's layout (full nav or the phone menu) and its register labels
// (long or short) come from the viewport width alone, in CSS
// (components/Header.astro), so the first frame a visitor sees is the last.
// Before, a script picked them after the page showed: long labels flashed and
// swapped to short ones on phones, and a desktop sometimes ended in the phone
// layout, depending on whether the fonts (or the bell's dot) were there yet.

// Records the header's state at every frame from the first one it is painted
// in (a frame callback runs just before the paint), and on any change to it.
const RECORD = () => {
  const log: string[] = [];
  (window as unknown as { __headerLog: string[] }).__headerLog = log;
  let painted = false;
  const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const snap = () => {
    const header = document.getElementById('site-header');
    if (!header || !document.getElementById('mobile-nav')) return;
    const state = JSON.stringify({
      fit: header.getAttribute('data-fit'),
      cls: header.className,
      nav: shown(document.getElementById('desktop-nav')),
      menu: shown(document.getElementById('nav-toggle')),
      long: [...header.querySelectorAll('.register-label-full')].map(shown),
      short: [...header.querySelectorAll('.register-label-short')].map(shown),
      rowHeight: Math.round(document.getElementById('header-row')!.getBoundingClientRect().height),
    });
    if (log[log.length - 1] !== state) log.push(state);
  };
  const start = performance.now();
  const frame = () => {
    if (!painted && document.getElementById('mobile-nav')) painted = true;
    if (painted) snap();
    if (performance.now() - start < 4000) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new MutationObserver(() => painted && snap()).observe(document, { subtree: true, childList: true, attributes: true });
};

const layout = (page: Page) =>
  page.evaluate(() => {
    const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none';
    return shown(document.getElementById('desktop-nav')) && !shown(document.getElementById('nav-toggle')) ? 'full' : 'compact';
  });

for (const width of [390, 1280]) {
  for (const path of ['/', '/calendar']) {
    test(`at ${width}px ${path} the header's first painted frame is its last (signed out)`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(RECORD);
      const page = await context.newPage();
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2500);
      const log = await page.evaluate(() => (window as unknown as { __headerLog: string[] }).__headerLog);
      expect(log.length, 'the header was recorded').toBeGreaterThan(0);
      expect(log, 'no change after the first paint').toHaveLength(1);
      const first = JSON.parse(log[0]);
      expect(first.nav).toBe(width >= 1024);
      expect(first.menu).toBe(width < 1024);
      await context.close();
    });
  }
}

test('ten reloads at 1280px all end in the full layout, and ten at 390px in the phone layout', async ({ browser }) => {
  for (const [width, expected] of [
    [1280, 'full'],
    [390, 'compact'],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    for (let i = 0; i < 10; i++) {
      await (i === 0 ? page.goto('/contact') : page.reload());
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      expect(await layout(page), `${width}px load ${i + 1}`).toBe(expected);
    }
    await context.close();
  }
});

// The widths lib/headerFit.ts plans the layout with must cover the header as
// drawn, in the site's fonts and in the fallback (fonts blocked), for every
// link and label the settings can show, not just today's.
for (const fonts of ['site', 'fallback'] as const) {
  test(`the header's planned widths cover every link and button as drawn (${fonts} fonts)`, async ({ browser }) => {
    for (const width of [390, 1024]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      if (fonts === 'fallback') await context.route(/\.woff2(\?|$)/, (route) => route.abort());
      const page = await context.newPage();
      await page.goto('/contact');
      await page.evaluate(() => document.fonts.ready);
      const drawn = await page.evaluate((labels) => {
        const w = (el: Element) => el.getBoundingClientRect().width;
        const nav = document.getElementById('desktop-nav')!;
        nav.style.display = 'flex';
        const proto = nav.querySelector('a:not(.admin-nav-link)')!;
        const links: Record<string, number> = {};
        for (const label of labels) {
          const a = proto.cloneNode(true) as HTMLElement;
          a.textContent = label;
          nav.appendChild(a);
          links[label] = w(a);
          a.remove();
        }
        const actions = document.getElementById('header-actions')!;
        const button = actions.querySelector('a[href="/register"]')!;
        const buttons: number[][] = [];
        for (const [long, short] of [['Register for Classes', 'Classes'], ['Register for Events', 'Events']]) {
          const sizes: number[] = [];
          for (const showLong of [true, false]) {
            const b = button.cloneNode(true) as HTMLElement;
            const [full, brief] = [b.querySelector<HTMLElement>('.register-label-full')!, b.querySelector<HTMLElement>('.register-label-short')!];
            full.textContent = long;
            brief.textContent = short;
            full.style.display = showLong ? 'inline' : 'none';
            brief.style.display = showLong ? 'none' : 'inline';
            actions.appendChild(b);
            sizes.push(w(b));
            b.remove();
          }
          buttons.push(sizes);
        }
        return { links, buttons, logo: w(document.querySelector('#header-row > a[href="/"]')!) };
      }, Object.keys(LINK_WIDTH));
      for (const [label, planned] of Object.entries(LINK_WIDTH)) expect(drawn.links[label], `${label} at ${width}`).toBeLessThanOrEqual(planned);
      const size = width >= 768 ? BUTTON_WIDTH.large : BUTTON_WIDTH.small;
      [size.classes, size.events].forEach((planned, i) => {
        expect(drawn.buttons[i][0], `button ${i} long at ${width}`).toBeLessThanOrEqual(planned[0]);
        expect(drawn.buttons[i][1], `button ${i} short at ${width}`).toBeLessThanOrEqual(planned[1]);
      });
      expect(drawn.logo).toBeLessThanOrEqual(width >= 640 ? LOGO_WIDTH.large : LOGO_WIDTH.small);
      await context.close();
    }
  });
}

// The Supabase client (~52 KB) only comes down when a session might be stored (lib/sessionHint.ts).
const SUPABASE_SCRIPT = /supabase|adminSession/i;

for (const path of ['/', '/calendar']) {
  test(`a signed-out visitor to ${path} downloads no Supabase auth client`, async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script') scripts.push(req.url());
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((url) => SUPABASE_SCRIPT.test(url))).toEqual([]);
  });
}

test('a signed-in admin still gets admin mode on the calendar, and the header admin links', async ({ page, adminPage }) => {
  void adminPage;
  await page.setViewportSize({ width: 1280, height: 900 });
  const scripts: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'script') scripts.push(req.url());
  });
  await page.goto('/calendar');
  await expect(page.locator('#add-event-btn')).toBeVisible();
  await expect(page.locator('#desktop-nav a[href="/admin"]')).toBeVisible();
  await expect(page.locator('#inbox-link')).toBeVisible();
  expect(scripts.some((url) => SUPABASE_SCRIPT.test(url))).toBe(true);
  // Nothing in the header row runs past it with the admin's extra links.
  expect(await page.evaluate(() => document.getElementById('header-row')!.scrollWidth <= document.getElementById('header-row')!.clientWidth)).toBe(true);
});

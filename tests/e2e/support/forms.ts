import { expect, type Page } from '@playwright/test';
import { RUN_ID, TEST_PREFIX } from './env';

export interface DancerInput {
  first: string;
  role?: 'leader' | 'follower';
  phone?: string;
  email?: string;
}

// Fills the Nth dancer block on /register or /register/events (adding blocks as needed).
export async function fillDancer(page: Page, index: number, d: DancerInput) {
  const blocks = page.locator('.dancer-block');
  while ((await blocks.count()) <= index) await page.locator('#add-dancer-btn').click();
  const block = blocks.nth(index);
  await block.locator('.dancer-first-name').fill(`${TEST_PREFIX}${d.first}`);
  await block.locator('.dancer-last-name').fill(RUN_ID);
  if (d.role) await block.locator(`.dancer-role-btn[data-role="${d.role}"]`).click();
  if (d.phone !== undefined || !d.email) await block.locator('.dancer-phone').fill(d.phone ?? '6085550100');
  if (d.email) await block.locator('.dancer-email').fill(d.email);
}

export async function selectSeries(page: Page, key: string) {
  const item = page.locator(`.series-item[data-key="${key}"]`);
  if ((await item.getAttribute('data-selected')) !== 'true') await item.locator('.series-toggle-btn').click();
  await expect(item).toHaveAttribute('data-selected', 'true');
  return item;
}

export async function payCash(page: Page) {
  await page.locator('.payment-item[data-value="cash"] .payment-toggle-btn').click();
}

export async function submitRegistration(page: Page) {
  await page.locator('form button[type="submit"]').click();
}

export const confirmationId = (url: string) => new URL(url).searchParams.get('id');

// Looks at a form's sending state without saving anything: the form's POST is held open, then answered
// with a 500 of our own. While it waits the button is disabled, busy and says what it is doing (same
// width); when the page is shown again (the pageshow a back button gives) the button is as it was.
// The page reports its own button (Playwright's page calls wait on a navigation that is held open).
export async function checkSendingState(page: Page, endpoint: string, busyLabel: string, originalLabel: string) {
  type Snap = { disabled: boolean; busy: string | null; text: string; width: number };
  const button = page.locator('form button[type="submit"]');
  const width = (await button.boundingBox())!.width;
  const snaps: Snap[] = [];
  await page.exposeBinding('reportSending', (_source, snap: Snap) => void snaps.push(snap));
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    const snap = () => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: b.textContent!.trim(), width: b.getBoundingClientRect().width });
    document.querySelector('form')!.addEventListener('submit', (e) => {
      if (e.defaultPrevented) return; // a first submit stopped for the email check

      setTimeout(() => {
        (window as unknown as { reportSending(s: unknown): void }).reportSending(snap());
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        (window as unknown as { reportSending(s: unknown): void }).reportSending(snap());
      }, 100);
    });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${endpoint}`, async (route) => {
    await gate;
    await route.fulfill({ status: 500, contentType: 'text/plain', body: 'ZZZ forced failure' });
  });

  await button.click({ noWaitAfter: true }); // the click would otherwise wait for the held POST to answer
  await expect.poll(() => snaps.length).toBe(2);
  expect(snaps[0]).toMatchObject({ disabled: true, busy: 'true', text: busyLabel });
  expect(snaps[0].width).toBeGreaterThanOrEqual(width - 0.5);
  // The page shown again: the button is usable once more.
  expect(snaps[1]).toMatchObject({ disabled: false, busy: null, text: originalLabel });

  // And after the request fails and the visitor goes back.
  release();
  await page.waitForURL(`**${endpoint}`);
  await page.goBack();
  await expect(button).toBeEnabled();
  await expect(button).toHaveText(originalLabel);
}

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

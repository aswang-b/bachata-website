import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { seedEvent, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout, recipients } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// Roadmap 7: the Venmo link a dancer taps is a pay link with the subtotal and the
// class names filled in (lib/venmoPay.ts), on the form (following the subtotal),
// on the confirmation page and in the confirmation email. The form's QR code
// stays the account code: Venmo's scanner can't read a pay link. Only hrefs are
// checked; nothing here opens venmo.com.
test.afterAll(sweepTestData);

let classA: Seeded;
let classB: Seeded;

test.beforeAll(async () => {
  classA = await seedEvent({ name: 'Pay Link A', priceWhole: 40, dayOffset: 2 });
  classB = await seedEvent({ name: 'Pay Link B', priceWhole: 25, dayOffset: 3 });
});

// The email sink keeps every email of the run, so each attempt (a retry, or --repeat-each) signs
// up with its own address and finds only its own email.
const attemptEmail = (name: string) => {
  const { retry, repeatEachIndex } = test.info();
  return `zzz-e2e-${RUN_ID.toLowerCase()}-${name}-${repeatEachIndex}-${retry}@example.com`;
};

const ACCOUNT_LINK = 'https://venmo.com/code?user_id=2024335518728192092&created=1788834419';
const payLink = (page: Page) => page.locator('#venmo-pay-link');
const payUrl = (amount: string, ...names: string[]) => `https://venmo.com/amumira?txn=pay&amount=${amount}&note=${encodeURIComponent(names.join(', '))}`;
const toggle = (page: Page, key: string) => page.locator(`.series-item[data-key="${key}"] .series-toggle-btn`).click();
// "$80" or "$37.50" as 80.00 / 37.50.
const dollars = (text: string) => Number(text.replace(/[^0-9.]/g, '')).toFixed(2);
const subtotalText = async (page: Page) => dollars((await page.locator('#subtotal-value').textContent())!);

async function openVenmo(page: Page) {
  const venmo = page.locator('.payment-item[data-value="venmo"]');
  await venmo.locator('.payment-toggle-btn').click();
  await expect(venmo.locator('.venmo-code svg')).toBeVisible();
  await expect(venmo).toHaveAttribute('data-selected', 'true');
  return venmo;
}

test('the form\'s Venmo link follows the subtotal and class names, and the QR code never changes', async ({ page }) => {
  await page.goto('/register');
  const venmo = await openVenmo(page);
  const qr = venmo.locator('.venmo-code');
  const qrBefore = await qr.innerHTML();
  expect(qrBefore).toContain('<svg');
  const link = venmo.getByRole('link', { name: 'Open in Venmo' });
  await expect(link).toHaveAttribute('id', 'venmo-pay-link');

  // Nothing chosen: the plain account link.
  await expect(link).toHaveAttribute('href', ACCOUNT_LINK);

  await selectSeries(page, classA.key);
  await expect(page.locator('#subtotal-value')).toHaveText('$40');
  expect(await subtotalText(page)).toBe('40.00');
  await expect(link).toHaveAttribute('href', payUrl('40.00', classA.title));
  expect(await qr.innerHTML()).toBe(qrBefore);

  // A second dancer doubles the subtotal.
  await fillDancer(page, 1, { first: 'Second' });
  await expect(page.locator('#subtotal-value')).toHaveText('$80');
  await expect(link).toHaveAttribute('href', payUrl('80.00', classA.title));

  // Another class: both names, the new total.
  await selectSeries(page, classB.key);
  await expect(page.locator('#subtotal-value')).toHaveText('$130');
  expect(await subtotalText(page)).toBe('130.00');
  await expect(link).toHaveAttribute('href', payUrl('130.00', classA.title, classB.title));
  expect(await qr.innerHTML()).toBe(qrBefore);

  // The first class taken off.
  await toggle(page, classA.key);
  await expect(page.locator('#subtotal-value')).toHaveText('$50');
  await expect(link).toHaveAttribute('href', payUrl('50.00', classB.title));

  // Everything taken off: back to the plain account link.
  await toggle(page, classB.key);
  await expect(page.locator('#subtotal-value')).toHaveText('$0');
  await expect(link).toHaveAttribute('href', ACCOUNT_LINK);
  expect(await qr.innerHTML()).toBe(qrBefore);
});

test('a Venmo sign-up\'s confirmation page and email say "Click here to pay." with the same amount as the receipt', async ({ page }) => {
  const email = attemptEmail('venmo');
  await page.goto(`/register?series=${classA.key}`);
  await selectSeries(page, classA.key);
  await fillDancer(page, 0, { first: 'PayLink', role: 'leader', email });
  await openVenmo(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  expect(confirmationId(page.url())).toBeTruthy();

  const line = page.locator('p', { hasText: 'You agreed to pay with Venmo.' });
  await expect(line).toHaveText('You agreed to pay with Venmo. Click here to pay.');
  const link = line.getByRole('link', { name: 'Click here to pay' });
  const total = dollars((await page.getByText('Subtotal', { exact: true }).locator('xpath=following-sibling::span').textContent())!);
  expect(total).toBe('40.00');
  const href = (await link.getAttribute('href'))!;
  expect(href).toBe(payUrl(total, classA.title));
  await expect(link).toHaveText('Click here to pay');

  // The email: the same link, absolute, after the same sentence.
  const sent = emailsAbout('ZZZPayLink').filter((e) => e.html.includes(RUN_ID) && recipients(e).includes(email));
  expect(sent).toHaveLength(1);
  const emailHref = sent[0].html.match(/You agreed to pay with Venmo\. <a href="([^"]*)"[^>]*>Click here to pay<\/a>\./)?.[1];
  expect(emailHref?.replace(/&amp;/g, '&')).toBe(href);
  expect(emailHref).toMatch(/^https:\/\/venmo\.com\//);
});

test('a cash sign-up has no pay sentence on the confirmation page or in the email', async ({ page }) => {
  const email = attemptEmail('nopay');
  await page.goto(`/register?series=${classB.key}`);
  await selectSeries(page, classB.key);
  await fillDancer(page, 0, { first: 'NoPay', role: 'follower', email });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  await expect(page.getByText('You agreed to pay with cash.')).toBeVisible();
  await expect(page.getByText('Click here to pay')).toHaveCount(0);
  await expect(page.locator('a[href*="venmo.com"]')).toHaveCount(0);

  const sent = emailsAbout('ZZZNoPay').filter((e) => e.html.includes(RUN_ID) && recipients(e).includes(email));
  expect(sent).toHaveLength(1);
  expect(sent[0].html).toContain('You agreed to pay with cash.');
  expect(sent[0].html).not.toContain('Click here to pay');
  expect(sent[0].html).not.toContain('venmo.com');
});

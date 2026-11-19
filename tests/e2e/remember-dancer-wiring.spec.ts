import { test, expect } from './support/fixtures';
import { sweepTestData } from './support/db';
import { TEST_PREFIX } from './support/env';

test.afterAll(sweepTestData);

// The remembered dancer was wired to the page's first <form>, so any form added
// ahead of the sign-up form (a banner, an embedded widget) silently switched it
// off. It is wired to the sign-up form itself.
test('the remembered dancer fills the sign-up form even when another form comes first on the page', async ({ page }) => {
  await page.route('**/register', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<body[^>]*>/, (open) => `${open}<form id="zzz-decoy" action="/nowhere"></form>`);
    await route.fulfill({ response, body: html });
  });
  await page.goto('/register');
  await page.evaluate(
    (name) => localStorage.setItem('dwb.dancer.v1', JSON.stringify({ firstName: name, lastName: 'Saved', email: 'zzz-wiring@example.com', phone: '6085550133', role: 'leader', savedAt: 1 })),
    `${TEST_PREFIX}Wiring`
  );
  await page.reload();
  expect(await page.evaluate(() => document.querySelector('form')?.id)).toBe('zzz-decoy');
  await expect(page.locator('.dancer-block').first().locator('.dancer-first-name')).toHaveValue(`${TEST_PREFIX}Wiring`);
  await expect(page.locator('.remembered-note')).toContainText('Filled in from your last sign-up');
});

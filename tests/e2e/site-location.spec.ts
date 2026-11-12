import { test, expect } from './support/fixtures';
import { sweepTestData } from './support/db';
import { bearer } from './support/admin';

// Dev and production share ONE database, so nothing here ever changes the
// stored location: the admin card saves exactly the values it loaded, and the
// homepage is checked against whatever is stored.
test.afterAll(sweepTestData);

const place = (loc: { city: string; state: string }) => (loc.state ? `${loc.city}, ${loc.state}` : loc.city);

test('Where we are: saving the current values unchanged says it saved', async ({ page, adminPage }) => {
  void adminPage;
  const loaded = page.waitForResponse((r) => r.url().includes('/api/admin/location') && r.request().method() === 'GET');
  await page.goto('/admin');
  await loaded;
  await page.locator('.admin-tab-btn[data-tab="admin"]').click();
  const city = page.locator('#site-location-city');
  await expect(city).toBeVisible();
  await expect(city).not.toHaveValue('');
  await page.locator('#site-location-save').click();
  await expect(page.locator('#site-location-status')).toHaveText('Saved. Pages update within a minute.');
});

test('the homepage names the stored city in its heading and title', async ({ page, request, admin }) => {
  const res = await request.get('/api/admin/location', { headers: bearer(admin) });
  expect(res.status()).toBe(200);
  const loc = await res.json();
  await page.goto('/');
  // The page's own heading: the Astro dev toolbar (outside <main>) has <h1>s of its own once it loads.
  await expect(page.locator('main h1')).toContainText(`Bachata with B · ${loc.city}`);
  expect(await page.title()).toContain(place(loc));
});

test('a non-admin cannot read or change the location', async ({ request }) => {
  expect((await request.get('/api/admin/location')).status()).toBe(403);
  const post = await request.post('/api/admin/location', { headers: { Origin: 'http://localhost:4322' }, data: { city: 'ZZZ Nowhere', state: '', note: '' } });
  expect(post.status()).toBe(403);
});

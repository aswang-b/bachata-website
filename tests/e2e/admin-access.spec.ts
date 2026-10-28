import { readdirSync } from 'node:fs';
import { test, expect } from './support/fixtures';
import { sweepTestData } from './support/db';
import { authStorageKey, bearer, createAdminSession, endAdminSession, signInBrowser } from './support/admin';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Every admin API route, from the source tree, so a new one is covered automatically.
const routes = readdirSync('src/pages/api/admin')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `/api/admin/${f.replace(/\.ts$/, '')}`);

test('every admin API route turns away a request with no or a bogus session', async ({ request }) => {
  expect(routes.length).toBeGreaterThan(30);
  for (const route of routes) {
    for (const headers of [{}, { Authorization: 'Bearer not-a-real-token' }] as Record<string, string>[]) {
      const get = await request.get(route, { headers });
      const post = await request.post(route, { headers: { ...headers, Origin: 'http://localhost:4322' }, data: {} });
      // check.ts answers 200 but must never say yes.
      if (route.endsWith('/check')) {
        expect((await get.json()).isAdmin, route).toBe(false);
        continue;
      }
      for (const res of [get, post]) {
        if (res.status() === 404 || res.status() === 405) continue; // method not offered
        expect([401, 403], `${res.url()} ${res.status()}`).toContain(res.status());
      }
    }
  }
});

test('the admin page asks a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#google-signin')).toBeVisible();
  await expect(page.locator('#account-admin')).toBeHidden();
});

test('an admin sees the admin tools', async ({ page, adminPage, admin }) => {
  void adminPage;
  await page.goto('/admin');
  await expect(page.locator('#account-admin')).toBeVisible();
  await expect(page.locator('#admin-email')).toHaveText(admin.user.email!);
  for (const tab of ['General', 'Homepage', 'Guidelines', 'Admin', 'Debug']) await expect(page.locator('.admin-tab-btn', { hasText: tab })).toBeVisible();
});

test('a stale stored session is refreshed instead of the admin being told they are "not an admin"', async ({ page, context }) => {
  const session = await createAdminSession();
  try {
    // A token the server rejects, with a refresh token that still works.
    await signInBrowser(context, { ...session, access_token: 'expired.or.revoked', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    await page.goto('/admin');
    await expect(page.locator('#account-admin')).toBeVisible();
    await expect(page.locator('#account-not-admin')).toBeHidden();
  } finally {
    // The page refreshed the session, so end the one it now holds.
    const stored = await page.evaluate((key) => localStorage.getItem(key), authStorageKey());
    if (stored) await endAdminSession(JSON.parse(stored));
    await endAdminSession(session);
  }
});

test('signing out of the admin page only signs out this browser, never the admin elsewhere', async ({ page, context, request }) => {
  const thisBrowser = await createAdminSession();
  const elsewhere = await createAdminSession();
  try {
    await signInBrowser(context, thisBrowser);
    await page.goto('/admin');
    await expect(page.locator('#account-admin')).toBeVisible();
    await page.locator('#signout-admin').click();
    await expect(page.locator('#google-signin')).toBeVisible();

    const check = await (await request.get('/api/admin/check', { headers: bearer(elsewhere) })).json();
    expect(check.isAdmin).toBe(true);
  } finally {
    await endAdminSession(thisBrowser);
    await endAdminSession(elsewhere);
  }
});

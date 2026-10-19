import { test as base, expect, type APIRequestContext } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { createAdminSession, endAdminSession, signInBrowser } from './admin';
import { BASE_URL } from './env';

const WARM_UP_PAGES = ['/', '/calendar', '/register', '/register/events', '/contact', '/check-in', '/admin', '/admin/analytics', '/admin/checkin-qr', '/admin/inbox'];

// Every spec imports `test` from here, so the safety check below always runs first.
export const test = base.extend<
  { adminPage: void; admin: Session; pageErrors: string[] },
  { testModeVerified: void; adminSession: Session }
>({
  // Refuses to run anything unless the dev server confirms emails go to the
  // sink file and Google is off — otherwise a test could email real people.
  testModeVerified: [
    async ({ playwright, browser }, use) => {
      const req = await playwright.request.newContext({ baseURL: BASE_URL });
      const res = await req.get('/api/test-mode');
      const status = res.ok() ? await res.json() : null;
      await req.dispose();
      if (!status?.emailSink || !status?.googleDisabled || !status?.usageCountersDisabled) {
        throw new Error(`The test dev server is not in test mode (${res.status()} ${JSON.stringify(status)}); refusing to run.`);
      }

      // A fresh dev server optimizes each page's browser dependencies on first
      // visit and then force-reloads that page, which can land mid-test (e.g.
      // between clicking Save and the save request). Visit every page once first.
      const warm = await browser.newPage({ baseURL: BASE_URL });
      for (const path of WARM_UP_PAGES) {
        await warm.goto(path).catch(() => undefined);
        await warm.waitForTimeout(1500);
      }
      await warm.close();
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  // One admin session per run, signed out (locally) at the end.
  adminSession: [
    async ({}, use) => {
      const session = await createAdminSession();
      await use(session);
      await endAdminSession(session);
    },
    { scope: 'worker' },
  ],
  admin: async ({ adminSession }, use) => use(adminSession),

  // Browser signed in as the admin.
  adminPage: async ({ context, adminSession }, use) => {
    await signInBrowser(context, adminSession);
    await use();
  },

  // Uncaught page errors, collected for tests that assert there are none.
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(errors);
  },
});

export { expect };

// Form POSTs like the browser sends them (Astro rejects cross-origin form posts).
export function postForm(request: APIRequestContext, path: string, fields: Record<string, string | string[]>) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) form.append(k, item);
  return request.post(path, {
    data: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE_URL },
    maxRedirects: 0,
  });
}

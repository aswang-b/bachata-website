import type { APIRequestContext } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { test, expect } from './support/fixtures';
import { seedEvent, sweepTestData } from './support/db';
import { bearer } from './support/admin';
import { BASE_URL } from './support/env';

// Short links on this site (/c/<code>, lib/shortLinks.ts): a door sign's code
// opens dancewithb.fun/c/<code>, which asks the QR site where it goes. The
// test server fakes the QR site (E2E_FAKE_QR, lib/brandedQr.ts), counting a
// scan only on GET like the real one, and fails on request (x-e2e-qr-down).
test.afterAll(sweepTestData);

const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const IMESSAGE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

interface SignState {
  signs: { id: string; heading: string; link_code: string; link_short: string; pointed_url: string; link: { hits: number } | null }[];
}

// Signs live in the test server's memory through a retry: each attempt names its own.
const attempt = () => (test.info().retry ? ` R${test.info().retry}` : '');

const studio = (request: APIRequestContext, admin: Session, data: Record<string, unknown>) =>
  request.post('/api/admin/qr-studio', { headers: { ...bearer(admin), Origin: BASE_URL }, data });

async function signNamed(request: APIRequestContext, admin: Session, heading: string) {
  const res = await request.get('/api/admin/qr-studio', { headers: bearer(admin) });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as SignState).signs.find((s) => s.heading === heading)!;
}

const hop = (request: APIRequestContext, path: string, opts: { method?: 'GET' | 'HEAD'; ua?: string; down?: string } = {}) =>
  request.fetch(path, {
    method: opts.method ?? 'GET',
    maxRedirects: 0,
    headers: { 'User-Agent': opts.ua ?? ANDROID_CHROME, ...(opts.down ? { 'x-e2e-qr-down': opts.down } : {}) },
  });

test('a sign’s code opens its classes through this site, counting only people; unknown codes and QR site outages', async ({ request, admin, page, adminPage }) => {
  void adminPage;
  const event = await seedEvent({ name: 'Short Link', priceDropIn: 15 });
  const heading = `${event.title}${attempt()}`;
  const saved = await studio(request, admin, { action: 'save', heading, eventIds: [event.ids[0]], createRegistration: false, showClasses: true, venmo: null });
  expect(saved.ok()).toBe(true);
  const sign = await signNamed(request, admin, heading);
  try {
    const path = `/c/${sign.link_code}`;
    const destination = `${BASE_URL}/check-in/${event.ids[0]}#`;
    expect(sign.pointed_url).toBe(`${BASE_URL}/check-in/${event.ids[0]}`);
    const hits = sign.link!.hits;

    // A person's scan: a 302 to the classes (the explicit "#" kept), never cached, counted once.
    const scan = await hop(request, path);
    expect(scan.status()).toBe(302);
    expect(scan.headers()['location']).toBe(destination);
    expect(scan.headers()['cache-control']).toBe('no-store');
    expect(scan.headers()['referrer-policy']).toBe('no-referrer');
    expect((await signNamed(request, admin, heading)).link!.hits).toBe(hits + 1);
    // In capitals too (some scanners upper-case a code).
    expect((await hop(request, `/c/${sign.link_code.toUpperCase()}`)).headers()['location']).toBe(destination);
    expect((await signNamed(request, admin, heading)).link!.hits).toBe(hits + 2);

    // Link previews (WhatsApp, iMessage) and HEAD get the same redirect and count nothing.
    for (const ua of [WHATSAPP, IMESSAGE]) {
      const preview = await hop(request, path, { ua });
      expect(preview.status()).toBe(302);
      expect(preview.headers()['location']).toBe(destination);
    }
    const head = await hop(request, path, { method: 'HEAD' });
    expect(head.status()).toBe(302);
    expect(head.headers()['location']).toBe(destination);
    expect((await signNamed(request, admin, heading)).link!.hits).toBe(hits + 2);

    // The QR site down (an error or no answer in time): the sign's saved address, uncounted.
    for (const down of ['error', 'timeout']) {
      const fallback = await hop(request, path, { down });
      expect(fallback.status()).toBe(302);
      expect(fallback.headers()['location']).toBe(destination);
      expect(fallback.headers()['cache-control']).toBe('no-store');
    }
    expect((await signNamed(request, admin, heading)).link!.hits).toBe(hits + 2);

    // A code that belongs to no sign while the QR site is down: try again.
    const unavailable = await hop(request, '/c/zzzzzzzzz', { down: 'error' });
    expect(unavailable.status()).toBe(503);
    expect(unavailable.headers()['cache-control']).toBe('no-store');
    expect(await unavailable.text()).toContain('Couldn’t open this code');

    // A code the QR site doesn't know, or one that can't be a code at all: not active.
    for (const bad of ['/c/zzzzzzzzz', '/c/not-a-code', '/c/abcdefghij', '/c/%3Cscript%3E']) {
      const missing = await hop(request, bad);
      expect(missing.status(), bad).toBe(404);
      expect(missing.headers()['cache-control']).toBe('no-store');
      expect(await missing.text()).toContain('This code isn’t active');
    }
    await page.goto('/c/zzzzzzzzz');
    await expect(page.getByRole('heading', { name: 'This code isn’t active' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute('href', '/');

    // The door sign page shows (and copies) this site's address for the code.
    expect(sign.link_short).toBe(`${BASE_URL}/c/${sign.link_code}`);
    await page.goto('/admin/qr');
    await expect(page.locator('.door-sign', { hasText: heading })).toContainText(`${BASE_URL}/c/${sign.link_code} ·`);

    // A real browser follows it to the check-in page.
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/check-in/${event.ids[0]}#?$`));
    await expect(page.getByText(event.title).first()).toBeVisible();
  } finally {
    await studio(request, admin, { action: 'delete', id: sign.id });
  }
});

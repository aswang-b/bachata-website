import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { seedEvent, sweepTestData } from './support/db';
import { bearer, signInBrowser } from './support/admin';

// The site installs as an app and sends push notifications. The manifest opens
// it full screen; a service worker (which caches nothing) is registered; on
// phones the header's bell pops up the notifications switch and how to add the
// site to the home screen (components/InstallApp.astro); admins send from
// /admin/notifications. The test server keeps subscriptions in memory and sends
// nothing (E2E_FAKE_PUSH), and the browser's push service is faked below.
test.afterAll(sweepTestData);

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0';

const phone = (browser: Browser, userAgent = ANDROID) => browser.newContext({ userAgent, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
const bell = (page: Page) => page.getByRole('button', { name: 'Notifications from B', exact: true });

// A browser push service that answers like the real one, without the network.
// `permission` is what the phone's "Allow notifications?" question answers. Like a
// real phone, it remembers both across reloads.
async function fakePushService(context: BrowserContext, permission: NotificationPermission = 'granted') {
  await context.addInitScript((answer) => {
    const saved = JSON.parse(localStorage.getItem('e2e-fake-push') ?? '{}') as { permission?: NotificationPermission; endpoint?: string | null };
    const save = () => localStorage.setItem('e2e-fake-push', JSON.stringify({ permission: current, endpoint: subscription?.endpoint ?? null }));
    let current: NotificationPermission = saved.permission ?? 'default';
    Object.defineProperty(Notification, 'permission', { get: () => current });
    Notification.requestPermission = async () => {
      current = answer;
      save();
      return current;
    };
    const make = (endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`) => {
      const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
      return {
        endpoint,
        toJSON: () => ({ endpoint, keys }),
        unsubscribe: async () => {
          subscription = null;
          save();
          return true;
        },
      } as unknown as PushSubscription;
    };
    let subscription: PushSubscription | null = saved.endpoint ? make(saved.endpoint) : null;
    PushManager.prototype.getSubscription = async () => subscription;
    PushManager.prototype.subscribe = async () => {
      subscription ??= make();
      save();
      return subscription;
    };
  }, permission);
}

const subscriberTotal = async (request: import('@playwright/test').APIRequestContext, admin: import('@supabase/supabase-js').Session) =>
  (await (await request.get('/api/admin/push', { headers: bearer(admin) })).json()).subscribers.total as number;

test('the site is installable: it opens full screen and registers a service worker that caches nothing', async ({ page, request }) => {
  const manifest = await (await request.get('/site.webmanifest')).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', scope: '/' });
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);

  // No fetch handler: every page still comes from the network.
  const worker = await (await request.get('/sw.js')).text();
  expect(worker).not.toContain("'fetch'");
  expect(worker).toContain("'push'");

  await page.goto('/');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test("on an Android phone, the bell turns notifications on and off, and shows how to install with Chrome's own button", async ({ browser, request, admin }) => {
  const context = await phone(browser);
  await fakePushService(context);
  const page = await context.newPage();
  await page.goto('/');
  const before = await subscriberTotal(request, admin);

  // A dot invites a first tap.
  await expect(page.locator('#app-bell-dot')).toBeVisible();
  await bell(page).click();
  const dialog = page.locator('#app-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#app-bell-dot')).toBeHidden();
  await expect(dialog.locator('#app-dialog-title')).toHaveText('Notifications from B');
  await expect(dialog.locator('strong', { hasText: 'None of your personal or device data is ever harvested.' })).toBeVisible();

  // Centered on the screen, not pinned to the bottom.
  const gaps = await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect();
    return { top: r.top, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right };
  });
  expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2);

  // Notifications: on, then off again.
  const toggle = dialog.getByRole('switch', { name: 'Notifications' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.locator('#push-status')).toContainText("You're all set");
  expect(await subscriberTotal(request, admin)).toBe(before + 1);
  // Still on after a reload.
  await page.reload();
  await bell(page).click();
  await expect(dialog.getByRole('switch', { name: 'Notifications' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('switch', { name: 'Notifications' }).click();
  await expect(dialog.getByRole('switch', { name: 'Notifications' })).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => subscriberTotal(request, admin)).toBe(before);

  // Its own phone's steps come first and open; the other's stay closed.
  await expect(dialog.locator('#app-guides details').first()).toHaveAttribute('data-platform', 'android');
  await expect(dialog.locator('[data-platform="android"]')).toHaveAttribute('open', '');
  await expect(dialog.locator('[data-platform="android"] .your-phone')).toBeVisible();
  await expect(dialog.locator('[data-platform="ios"]')).not.toHaveAttribute('open');

  // Chrome offers to install: the button shows, and opens Chrome's own prompt.
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      },
    });
    window.dispatchEvent(event);
  });
  await page.locator('#install-app').click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);

  await page.locator('#app-dialog-close').click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await context.close();
});

test('when the phone blocks notifications, the switch says where to allow them', async ({ browser }) => {
  const context = await phone(browser);
  await fakePushService(context, 'denied');
  const page = await context.newPage();
  await page.goto('/');
  await bell(page).click();
  const toggle = page.getByRole('switch', { name: 'Notifications' });
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await expect(page.locator('#push-status')).toContainText('Notifications are blocked');
  await context.close();
});

test('in Safari on an iPhone (no notifications outside the app), it shows how to install, then to tap the bell in the app', async ({ browser }) => {
  const context = await phone(browser, IPHONE_SAFARI);
  await context.addInitScript(() => delete (window as { PushManager?: unknown }).PushManager);
  const page = await context.newPage();
  await page.goto('/');
  await bell(page).click();
  await expect(page.locator('#app-push')).toBeHidden();
  await expect(page.locator('#ios-then-bell')).toBeVisible();
  await expect(page.locator('#app-guides details').first()).toHaveAttribute('data-platform', 'ios');
  await expect(page.locator('[data-platform="ios"]')).toHaveAttribute('open', '');
  await context.close();
});

test('inside Instagram on an iPhone, it says to open a browser first', async ({ browser }) => {
  const context = await phone(browser, IPHONE_INSTAGRAM);
  const page = await context.newPage();
  await page.goto('/');
  await bell(page).click();
  await expect(page.locator('#app-status')).toContainText('Open in browser');
  await context.close();
});

test('on a computer, the bell has just the notifications switch; inside the installed app on a phone too', async ({ browser }) => {
  const computer = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakePushService(computer);
  const page = await computer.newPage();
  await page.goto('/');
  await bell(page).click();
  const toggle = page.getByRole('switch', { name: 'Notifications' });
  await expect(toggle).toBeVisible();
  await expect(page.locator('#push-what')).toContainText('on this computer');
  await expect(page.locator('#app-install')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await computer.close();

  const context = await phone(browser);
  await fakePushService(context);
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes('display-mode: standalone') ? ({ ...real(query), matches: true } as MediaQueryList) : real(query));
  });
  const app = await context.newPage();
  await app.goto('/');
  await bell(app).click();
  await expect(app.getByRole('switch', { name: 'Notifications' })).toBeVisible();
  await expect(app.locator('#app-install')).toBeHidden();
  await context.close();
});

test('no bell on a computer whose browser has no push notifications', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => delete (window as { PushManager?: unknown }).PushManager);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#site-header')).toBeVisible();
  await expect(page.locator('#app-bell')).toHaveCount(0);
  await context.close();
});

test('admins get their inbox there instead (on a phone and on a computer), and the bell again when previewing as the public', async ({ browser, adminSession }) => {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await signInBrowser(desk, adminSession);
  const deskPage = await desk.newPage();
  await deskPage.goto('/');
  await expect(deskPage.locator('#inbox-link')).toBeVisible();
  await expect(deskPage.locator('#app-bell')).toHaveCount(0);
  await desk.close();

  const context = await phone(browser);
  await signInBrowser(context, adminSession);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#inbox-link')).toBeVisible();
  await expect(page.locator('#app-bell')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('bwb-preview-as-public', 'true'));
  await page.reload();
  await expect(bell(page)).toBeVisible();
  await expect(page.locator('#inbox-link')).toBeHidden();
  await page.evaluate(() => localStorage.removeItem('bwb-preview-as-public'));
  await context.close();
});

test('an admin sends a notification about an event, is asked before sending about it again, and sees how it did', async ({ page, adminPage, admin, request }) => {
  void adminPage;
  // A phone that turned notifications on (only pages on this site, and real push services, are accepted).
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-admin-${Date.now()}`;
  const subscribe = (e: string) => request.post('/api/push', { data: { action: 'subscribe', subscription: { endpoint: e, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, platform: 'ios' } });
  expect((await subscribe(endpoint)).ok()).toBe(true);
  expect((await subscribe('https://evil.example/push')).status()).toBe(400);

  const event = await seedEvent({ name: 'Push Workshop', type: 'event' });
  // From the calendar editor's Notify link: the message starts filled in.
  await page.goto(`/admin/notifications?event=${event.ids[0]}`);
  await expect(page.locator('#push-admin')).toBeVisible();
  await expect(page.locator('#subscriber-count')).toHaveText(/^\d+ devices? gets? notifications \(.*\d+ iPhone.*\)\.$/);
  const title = `New event: ${event.title}`;
  await expect(page.locator('#push-title')).toHaveValue(title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title);
  await expect(page.locator('#push-url')).toHaveValue('/register/events');
  await expect(page.locator('#preview-body')).toContainText('Tap to register');

  // A link off the site is refused.
  await page.locator('#push-url').fill('https://evil.example');
  page.once('dialog', (d) => d.accept());
  await page.locator('#push-send').click();
  await expect(page.locator('#send-status')).toContainText('page on this site');

  await page.locator('#push-url').fill('/register/events');
  page.once('dialog', (d) => d.accept());
  await page.locator('#push-send').click();
  await expect(page.locator('#send-status')).toContainText('Sent to');
  const card = page.locator('.push-send').first();
  await expect(card).toContainText(event.title);

  // The device shows it and someone taps it (public/sw.js reports only the send's id).
  const sends = (await (await request.get('/api/admin/push', { headers: bearer(admin) })).json()).sends as { id: string; delivered: number }[];
  const sent = sends[0];
  const report = (action: string, id: unknown) => request.post('/api/push', { data: { action, id } });
  expect((await (await report('shown', sent.id)).json()).ok).toBe(true);
  expect((await (await report('opened', sent.id)).json()).ok).toBe(true);
  expect((await report('opened', 'not-an-id')).status()).toBe(400);
  expect((await (await report('shown', '00000000-0000-0000-0000-000000000000')).json()).ok).toBe(false);
  await page.reload();
  const stats = page.locator('.push-send').first().locator('.push-stats');
  await expect(stats).toContainText(`${sent.delivered} reached`);
  await expect(stats).toContainText('1 shown');
  await expect(stats).toContainText('1 opened (100%)');
  // Neither count can pass how many it reached.
  for (let i = 0; i < sent.delivered + 2; i++) await report('shown', sent.id);
  await page.reload();
  await expect(page.locator('.push-send').first().locator('.push-stats')).toContainText(`${sent.delivered} shown`);

  // Again about the same event: it asks first, and declining sends nothing.
  await expect(page.locator('#push-title')).toHaveValue(/New event/);
  const sentBefore = await page.locator('.push-send').count();
  const questions: string[] = [];
  page.on('dialog', (d) => {
    questions.push(d.message());
    void (d.message().includes('already sent') ? d.dismiss() : d.accept());
  });
  await page.locator('#push-send').click();
  await expect.poll(() => questions.some((q) => q.includes('already sent'))).toBe(true);
  await expect(page.locator('.push-send')).toHaveCount(sentBefore);

  // The phone turns them off.
  await request.post('/api/push', { data: { action: 'unsubscribe', endpoint, auth: 'a'.repeat(22) } });
});

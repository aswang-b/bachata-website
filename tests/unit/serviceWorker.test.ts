import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// public/sw.js, run with a stand-in `self`: what a push shows, depending on the
// installed-app flag the pages leave in Cache Storage (components/InstallApp.astro).

const source = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const DAY = 864e5;

async function showPush(flag: string | null): Promise<NotificationOptions> {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: NotificationOptions[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
    registration: { showNotification: async (_title: string, options: NotificationOptions) => void shown.push(options) },
    navigator: { userAgent: 'Android' },
  };
  const caches = { match: async () => (flag === null ? undefined : new Response(flag)) };
  runInNewContext(source, { self, caches, fetch: async () => new Response(''), Response, URL, Date, Number, JSON, Promise, String, Boolean });
  let done: Promise<unknown> = Promise.resolve();
  handlers.push({ data: { json: () => ({ title: 'New class', body: 'Hi', id: 'x' }) }, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  return shown[0];
}

describe('service worker notifications', () => {
  it('show the logo picture when the app was never seen installed', async () => {
    expect((await showPush(null)).icon).toBe('/icon-192.png');
  });

  it('leave the logo out when a page saw the app installed recently (the phone already shows its icon)', async () => {
    expect((await showPush(String(Date.now() - 2 * DAY))).icon).toBeUndefined();
  });

  it('bring the logo back once the flag is over 30 days old, as the app may have been removed', async () => {
    expect((await showPush(String(Date.now() - 31 * DAY))).icon).toBe('/icon-192.png');
  });

  it("show the logo for an old-style flag ('1') or anything unreadable", async () => {
    expect((await showPush('1')).icon).toBe('/icon-192.png');
    expect((await showPush('garbage')).icon).toBe('/icon-192.png');
  });
});

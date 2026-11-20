import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLinkPreviewBot } from '../../src/lib/linkPreviewBot';
import { askQrSite, cleanShortCode, resolveShortLink, savedDestination, shortLinkHost, siteShortLink, withEmptyFragment } from '../../src/lib/shortLinks';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

// Short links on this site (/c/<code>): which requests count as scans, which
// codes are codes, and what happens when the QR site answers, or doesn't.

const UA = {
  whatsappAndroid: 'WhatsApp/2.23.20.0 A',
  whatsappIos: 'WhatsApp/2.23.18.78 i',
  imessage: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  telegram: 'TelegramBot (like TwitterBot)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  googlebotPhone: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.155 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bing: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  snapchat: 'Mozilla/5.0 (compatible; Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots)',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
  instagramInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 325.0.0.35.91 (iPhone15,2; iOS 17_4; en_US; en; scale=3.00; 1179x2556; 590446212)',
  facebookInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.36.106;FBBV/577287145;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  pinterestInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
  // A phone whose model name holds "bot".
  cubot: 'Mozilla/5.0 (Linux; Android 11; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

describe('link-preview bots', () => {
  it('knows the apps that fetch a link to preview it, and crawlers', () => {
    for (const ua of [UA.whatsappAndroid, UA.whatsappIos, UA.imessage, UA.facebook, UA.telegram, UA.slack, UA.discord, UA.googlebotPhone, UA.bing, UA.ahrefs, UA.snapchat]) expect(isLinkPreviewBot(ua), ua).toBe(true);
    for (const ua of ['Twitterbot/1.0', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'Mozilla/5.0 (Macintosh) Applebot/0.1', 'Pinterestbot/1.0', 'Embedly/0.2', 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5']) expect(isLinkPreviewBot(ua), ua).toBe(true);
  });

  it('counts people on phones, in any browser or in-app browser, even on a phone named like a bot', () => {
    for (const ua of [UA.chromeAndroid, UA.safariIos, UA.samsung, UA.firefoxAndroid, UA.instagramInApp, UA.facebookInApp, UA.pinterestInApp, UA.cubot]) expect(isLinkPreviewBot(ua), ua).toBe(false);
  });

  it('takes a request with no user agent for a script', () => {
    expect(isLinkPreviewBot(null)).toBe(true);
    expect(isLinkPreviewBot('  ')).toBe(true);
  });
});

describe('codes', () => {
  it('takes the QR site’s codes in any case, lower-cased, and nothing else', () => {
    expect(cleanShortCode('t1')).toBe('t1');
    expect(cleanShortCode('AB9')).toBe('ab9');
    expect(cleanShortCode('a'.repeat(9))).toBe('a'.repeat(9));
    for (const bad of ['', 'a'.repeat(10), 'a-b', 'a_b', 'ab/c', '../x', 'é', ' ab', 'ab ', '%2e', undefined, null, 42]) expect(cleanShortCode(bad), String(bad)).toBeNull();
  });

  it('builds this site’s address for a code, and gives a destination an explicit empty fragment', () => {
    expect(siteShortLink('https://dancewithb.fun', 'b')).toBe('https://dancewithb.fun/c/b');
    expect(siteShortLink('http://localhost:4322/', 't1')).toBe('http://localhost:4322/c/t1');
    expect(withEmptyFragment('https://dancewithb.fun/check-in/1')).toBe('https://dancewithb.fun/check-in/1#');
    expect(withEmptyFragment('https://dancewithb.fun/check-in#top')).toBe('https://dancewithb.fun/check-in#top');
  });
});

describe('asking the QR site', () => {
  beforeEach(() => {
    db.current = new FakeSupabase();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const redirectTo = (location: string) => vi.fn(async () => new Response(null, { status: 302, headers: { Location: location } }));

  it('asks without following the redirect, naming this host, and GET only when a person scans', async () => {
    const fetch = redirectTo('https://dancewithb.fun/check-in/1#');
    vi.stubGlobal('fetch', fetch);
    expect(await askQrSite('b', { count: true, host: 'dancewithb.fun' })).toEqual({ kind: 'redirect', location: 'https://dancewithb.fun/check-in/1#' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qr.dancewithb.fun/c/b');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { 'X-Short-Link-Host': 'dancewithb.fun' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    await resolveShortLink('b', { method: 'GET', userAgent: UA.whatsappAndroid, host: 'dancewithb.fun' });
    await resolveShortLink('b', { method: 'HEAD', userAgent: UA.safariIos, host: 'dancewithb.fun' });
    await resolveShortLink('b', { method: 'GET', userAgent: UA.safariIos, host: 'dancewithb.fun' });
    expect(fetch.mock.calls.slice(1).map((c) => (c as unknown as [string, RequestInit])[1].method)).toEqual(['HEAD', 'HEAD', 'GET']);
  });

  it('names the site’s own host to the QR site, whatever host the scan came in on (the test server’s own when faked)', async () => {
    for (const host of ['dancewithb.fun', 'www.dancewithb.fun', 'deploy-preview-12--dancewithb.netlify.app', 'main--dancewithb.netlify.app']) expect(shortLinkHost(host)).toBe('dancewithb.fun');
    const fetch = redirectTo('https://dancewithb.fun/check-in#');
    vi.stubGlobal('fetch', fetch);
    await resolveShortLink('b', { method: 'GET', userAgent: UA.safariIos, host: 'deploy-preview-12--dancewithb.netlify.app' });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ 'X-Short-Link-Host': 'dancewithb.fun' });
    vi.stubEnv('E2E_FAKE_QR', '1');
    try {
      expect(shortLinkHost('localhost:4322')).toBe('localhost:4322');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the QR site’s Location as it is; an unknown code is missing', async () => {
    vi.stubGlobal('fetch', redirectTo('https://example.com/a?b=1#'));
    expect(await resolveShortLink('b', { method: 'GET', userAgent: UA.safariIos, host: 'dancewithb.fun' })).toEqual({ kind: 'redirect', location: 'https://example.com/a?b=1#' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await resolveShortLink('b', { method: 'GET', userAgent: UA.safariIos, host: 'dancewithb.fun' })).toEqual({ kind: 'missing' });
  });

  it('falls back to the door sign’s saved address when the QR site errs, times out or is unreachable, and logs it once per code', async () => {
    db.current.seed('door_signs', [{ id: 's1', link_code: 'b', pointed_url: 'https://dancewithb.fun/check-in/1' }]);
    db.current.seed('site_config', [{ id: true, qr_studio: null }]);
    const logged: Record<string, unknown>[] = [];
    db.current.rpcHandlers.log_site_error = (args) => logged.push(args);
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    for (const fetch of [vi.fn(async () => new Response('down', { status: 503 })), vi.fn(async () => Promise.reject(timeout)), vi.fn(async () => Promise.reject(new TypeError('fetch failed'))), redirectTo('javascript:alert(1)')]) {
      vi.stubGlobal('fetch', fetch);
      expect(await resolveShortLink('b', { method: 'GET', userAgent: UA.safariIos, host: 'dancewithb.fun' })).toEqual({ kind: 'redirect', location: 'https://dancewithb.fun/check-in/1#' });
    }
    expect(logged).toHaveLength(4);
    expect(logged.map((l) => l.p_dedupe_key)).toEqual(Array(4).fill('short_link:b'));
    expect(logged[0]).toMatchObject({ p_kind: 'short_link', p_details: { code: 'b', reason: 'status 503', fallback: 'https://dancewithb.fun/check-in/1#' } });
    expect(String(logged[1].p_message)).toContain('no answer within 3 s');
  });

  it('falls back to the first check-in link’s remembered address; with none, the scan is told to try again', async () => {
    db.current.seed('door_signs', []);
    db.current.seed('site_config', [{ id: true, qr_studio: { checkin: { code: 'a', short: 'https://qr.dancewithb.fun/c/a', pointedUrl: 'https://dancewithb.fun/check-in?events=1,2' }, venmo: [] } }]);
    db.current.rpcHandlers.log_site_error = () => null;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    expect(await savedDestination('a')).toBe('https://dancewithb.fun/check-in?events=1,2#');
    expect(await resolveShortLink('zz', { method: 'GET', userAgent: UA.safariIos, host: 'dancewithb.fun' })).toEqual({ kind: 'unavailable' });
  });
});

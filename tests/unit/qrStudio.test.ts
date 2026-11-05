import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkinUrl, eventIdsFrom } from '../../src/lib/checkinLink';
import { cleanVenmoUsername, lookupVenmo, parseVenmoProfile, venmoCodeUrl } from '../../src/lib/venmo';
import { BrandedQrError, codeSvg, createLink, listLinks, pointLink } from '../../src/lib/brandedQr';

// The door sign (/admin/qr): Venmo lookups, check-in addresses, and calls to qr.dancewithb.fun.

const profilePage = (user: Record<string, unknown>) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { user } } })}</script></body></html>`;
const amumira = { displayName: 'B Zh', id: '2024335518728192092', username: 'amumira', profilePictureUrl: 'https://pics-v3.venmo.com/abc' };

describe('Venmo accounts', () => {
  it('reads the id, name and photo from a profile page, as Venmo codes need the id', () => {
    expect(parseVenmoProfile(profilePage(amumira), 'Amumira')).toEqual({ username: 'amumira', name: 'B Zh', userId: '2024335518728192092', picture: 'https://pics-v3.venmo.com/abc' });
    expect(venmoCodeUrl('2024335518728192092')).toBe('https://venmo.com/code?user_id=2024335518728192092');
  });

  it("refuses a page that isn't that person's profile", () => {
    expect(parseVenmoProfile('<html>not found</html>', 'amumira')).toBeNull();
    expect(parseVenmoProfile(profilePage({ ...amumira, username: 'someoneelse' }), 'amumira')).toBeNull();
    expect(parseVenmoProfile(profilePage({ ...amumira, id: 'not-a-number' }), 'amumira')).toBeNull();
    expect(parseVenmoProfile('<script id="__NEXT_DATA__" type="application/json">{broken</script>', 'amumira')).toBeNull();
    // A photo that isn't https is dropped, not shown.
    expect(parseVenmoProfile(profilePage({ ...amumira, profilePictureUrl: 'javascript:alert(1)' }), 'amumira')!.picture).toBeNull();
  });

  it('takes a username with or without its @, and nothing that could change the address', () => {
    expect(cleanVenmoUsername(' @amumira ')).toBe('amumira');
    expect(cleanVenmoUsername('Luna-Moves_2')).toBe('Luna-Moves_2');
    expect(cleanVenmoUsername('a b')).toBeNull();
    expect(cleanVenmoUsername('../x')).toBeNull();
    expect(cleanVenmoUsername(42)).toBeNull();
  });

  describe('looking someone up', () => {
    afterEach(() => vi.unstubAllGlobals());

    it("says when Venmo has no such user, or its page can't be read", async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
      await expect(lookupVenmo('nobody-here')).rejects.toThrow('Venmo has no @nobody-here');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>changed</html>', { status: 200 })));
      await expect(lookupVenmo('amumira')).rejects.toThrow("Couldn't read @amumira's Venmo profile");
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
      await expect(lookupVenmo('amumira')).rejects.toThrow("Couldn't reach Venmo");
      await expect(lookupVenmo('bad name')).rejects.toThrow('letters, numbers');
    });

    it('finds them on their profile page', async () => {
      const fetch = vi.fn(async () => new Response(profilePage(amumira), { status: 200 }));
      vi.stubGlobal('fetch', fetch);
      expect((await lookupVenmo('@amumira')).userId).toBe('2024335518728192092');
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://account.venmo.com/u/amumira');
    });
  });
});

describe('check-in addresses', () => {
  it('keeps one class on its own page, and lists several with their register tokens', () => {
    expect(checkinUrl('https://dancewithb.fun', ['a'], [])).toBe('https://dancewithb.fun/check-in/a');
    expect(checkinUrl('https://dancewithb.fun', ['a'], ['t1'])).toBe('https://dancewithb.fun/check-in/a?register=t1');
    expect(checkinUrl('https://dancewithb.fun', ['a', 'b'], [])).toBe('https://dancewithb.fun/check-in?events=a,b');
    expect(checkinUrl('https://dancewithb.fun', ['a', 'b'], ['t1', 't2'])).toBe('https://dancewithb.fun/check-in?events=a,b&register=a.t1,b.t2');
  });

  it('reads the picked classes once each, from either field', () => {
    expect(eventIdsFrom({ eventIds: ['a', 'b', 'a', '', 3] })).toEqual(['a', 'b']);
    expect(eventIdsFrom({ eventId: 'a' })).toEqual(['a']);
    expect(eventIdsFrom(null)).toEqual([]);
  });
});

describe('qr.dancewithb.fun', () => {
  beforeEach(() => {
    process.env.QR_API_TOKEN = 'qra_test';
  });
  afterEach(() => {
    delete process.env.QR_API_TOKEN;
    vi.unstubAllGlobals();
  });

  it('calls each method with the author token, as POST JSON', async () => {
    const fetch = vi.fn(async () => Response.json({ links: [] }));
    vi.stubGlobal('fetch', fetch);
    await listLinks();
    await createLink('https://dancewithb.fun/check-in', 'Class check-in');
    await pointLink('a', 'https://dancewithb.fun/check-in/x');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://qr.dancewithb.fun/api/link.read',
      'https://qr.dancewithb.fun/api/link.create',
      'https://qr.dancewithb.fun/api/link.update',
    ]);
    expect(calls[2][1].method).toBe('POST');
    expect((calls[2][1].headers as Record<string, string>).Authorization).toBe('Bearer qra_test');
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ code: 'a', url: 'https://dancewithb.fun/check-in/x' });
  });

  it('explains a refused token, and never uses something other than an SVG as a code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unknown token' }, { status: 401 })));
    await expect(listLinks()).rejects.toThrow('QR_API_TOKEN was refused');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })));
    await expect(codeSvg(991)).rejects.toThrow('something other than an SVG');
  });

  it('says what to set up when there is no token', async () => {
    delete process.env.QR_API_TOKEN;
    const err = await listLinks().catch((e) => e);
    expect(err).toBeInstanceOf(BrandedQrError);
    expect(err.message).toContain('set QR_API_TOKEN');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkinUrl, eventIdsFrom } from '../../src/lib/checkinLink';
import { cleanVenmoUsername, lookupVenmo, parseVenmoProfile, venmoCodeUrl } from '../../src/lib/venmo';
import { BrandedQrError, batchUrl, codeSvg, codesFor, createLink, createTicket, isVivid, listLinks, pointLink } from '../../src/lib/brandedQr';
import { addPoolLink, isPoolLink, LEGACY_LABEL, poolLinks } from '../../src/lib/doorSigns';
import { DANCE_WITH_B_VENMO, loadQrStudio, normalize, updateQrStudio } from '../../src/lib/qrStudioStore';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

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
    await createLink('https://dancewithb.fun/check-in', 'Door sign', 'door-sign-1');
    await pointLink('a', 'https://dancewithb.fun/check-in/x', 'https://dancewithb.fun/check-in');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://qr.dancewithb.fun/api/link.read',
      'https://qr.dancewithb.fun/api/link.create',
      'https://qr.dancewithb.fun/api/link.update',
    ]);
    expect(calls[2][1].method).toBe('POST');
    expect((calls[2][1].headers as Record<string, string>).Authorization).toBe('Bearer qra_test');
    // Only if it still opens what the site last saw (if_url); a key makes a retried create return the same link.
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ code: 'a', url: 'https://dancewithb.fun/check-in/x', if_url: 'https://dancewithb.fun/check-in' });
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({ key: 'door-sign-1' });
  });

  it('explains a refused token, and never uses something other than an SVG as a code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unknown token' }, { status: 401 })));
    await expect(listLinks()).rejects.toThrow('QR_API_TOKEN was refused');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })));
    await expect(codeSvg('https://qr.dancewithb.fun/q/991.svg?sig=a')).rejects.toThrow('something other than an SVG');
    // Only the QR site's own code images are fetched.
    await expect(codeSvg('https://evil.example/q/1.svg')).rejects.toThrow("isn't one of");
  });

  it('says what to set up when there is no token', async () => {
    delete process.env.QR_API_TOKEN;
    const err = await listLinks().catch((e) => e);
    expect(err).toBeInstanceOf(BrandedQrError);
    expect(err.message).toContain('set QR_API_TOKEN');
  });
});

describe("the door sign's saved settings", () => {
  const luna = { username: 'lunamoves', name: 'Luna', userId: '1', picture: null, label: 'Luna' };

  it('keeps an emptied Venmo list empty, and fills in Dance with B only before anything was saved', () => {
    expect(normalize(null)).toEqual({ checkin: null, venmo: [DANCE_WITH_B_VENMO], defaultVenmo: 'amumira' });
    expect(normalize({ venmo: [], defaultVenmo: null })).toEqual({ checkin: null, venmo: [], defaultVenmo: null });
    expect(normalize({ venmo: [luna], defaultVenmo: null }).defaultVenmo).toBeNull();
  });

  it("two admins saving at once don't undo each other", async () => {
    db.current = new FakeSupabase().seed('site_config', [{ id: true, qr_studio: { checkin: null, venmo: [DANCE_WITH_B_VENMO], defaultVenmo: 'amumira', rev: 'r1' } }]);
    // Another admin points the link between this save's read and its write.
    db.current.beforeNext.set('site_config.update', () => {
      db.current.rows('site_config')[0].qr_studio = {
        checkin: { code: 'a', short: 's', designId: null, pointedUrl: 'u', pointedLabel: 'Monday', pointedAt: '2026-11-05T00:00:00Z' },
        venmo: [DANCE_WITH_B_VENMO],
        defaultVenmo: 'amumira',
        rev: 'r2',
      };
    });
    await updateQrStudio((s) => {
      s.venmo = [...s.venmo, luna];
    });
    const { studio } = await loadQrStudio();
    expect(studio.checkin?.pointedLabel).toBe('Monday');
    expect(studio.venmo.map((a) => a.username)).toEqual(['amumira', 'lunamoves']);
    expect(db.current.callsTo('site_config', 'update')).toHaveLength(2);
  });

  it('removing the last account sticks', async () => {
    db.current = new FakeSupabase().seed('site_config', [{ id: true, qr_studio: null }]);
    await updateQrStudio((s) => {
      s.venmo = [];
      s.defaultVenmo = null;
    });
    expect((await loadQrStudio()).studio).toEqual({ checkin: null, venmo: [], defaultVenmo: null });
  });
});

describe('branded codes from qr.dancewithb.fun', () => {
  beforeEach(() => {
    process.env.QR_API_TOKEN = 'qra_test';
  });
  afterEach(() => {
    delete process.env.QR_API_TOKEN;
    vi.unstubAllGlobals();
  });

  it('refuses an SVG that could run script', async () => {
    for (const svg of ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>', '<svg><a href="javascript:x"/></svg>', '<svg><foreignObject/></svg>']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(svg, { status: 200 })));
      await expect(codeSvg(`https://qr.dancewithb.fun/q/501.svg?sig=${svg.length}`)).rejects.toThrow('scripts in it');
    }
  });

  it('keeps a code image for a while', async () => {
    const fetch = vi.fn(async () => new Response('<svg>one</svg>', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const url = 'https://qr.dancewithb.fun/q/502.svg?sig=a';
    expect(await codeSvg(url)).toBe('<svg>one</svg>');
    fetch.mockImplementation(async () => new Response('<svg>two</svg>', { status: 200 }));
    expect(await codeSvg(url)).toBe('<svg>one</svg>');
    // It needs no token (the address is signed).
    expect((fetch.mock.calls[0] as unknown[])[1]).not.toHaveProperty('headers');
  });

  it("asks for only the link's own codes, once a minute unless asked again", async () => {
    const designs = [{ id: 7, name: 'Pink', created_at: 1, svg_url: 'https://qr.dancewithb.fun/q/7.svg?sig=x', link: { code: 'zz', short: 's', url: 'u' } }];
    const fetch = vi.fn(async () => Response.json({ designs }));
    vi.stubGlobal('fetch', fetch);
    expect((await codesFor('zz')).map((c) => c.id)).toEqual([7]);
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ link: 'zz' });
    await codesFor('zz');
    expect(fetch).toHaveBeenCalledTimes(1);
    await codesFor('zz', true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says where a link points now when it was changed meanwhile', async () => {
    const now = { code: 'a', short: 's', url: 'https://dancewithb.fun/check-in/other', label: '', key: null, hits: 0, created_at: 1, updated_at: 2, last_hit: null };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'url changed', link: now }, { status: 409 })));
    const err = await pointLink('a', 'https://dancewithb.fun/check-in/x', 'https://dancewithb.fun/check-in').catch((e) => e);
    expect(err).toBeInstanceOf(BrandedQrError);
    expect(err.status).toBe(409);
    expect(err.link.url).toBe('https://dancewithb.fun/check-in/other');
  });

  it("opens the generator for several links at once, in an existing code's look, coming back here", () => {
    const url = new URL(batchUrl(['a', 'b'], 12, 'https://dancewithb.fun/admin/qr'));
    expect(url.origin).toBe('https://qr.dancewithb.fun');
    expect(url.searchParams.get('batch')).toBe('a,b');
    expect(url.searchParams.get('from')).toBe('12');
    expect(url.searchParams.get('name')).toBe('Door sign {code}');
    expect(url.searchParams.get('return')).toBe('https://dancewithb.fun/admin/qr');
    expect(new URL(batchUrl(['a'], null, 'https://dancewithb.fun/admin/qr')).searchParams.has('from')).toBe(false);
    // Vivid colours, always.
    expect(url.searchParams.get('contrast')).toBe('0.56');
  });

  it('asks the embedded generator for vivid colours, and to replace old codes only when remaking', async () => {
    const fetch = vi.fn(async () => Response.json({ url: 'https://qr.dancewithb.fun/embed#t=x', expires_at: 1 }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await createTicket(['d', 'e'], 4, 'https://dancewithb.fun');
    await createTicket(['c'], 4, 'https://dancewithb.fun', true);
    const bodies = (fetch.mock.calls as unknown as [string, RequestInit][]).map(([u, init]) => [u, JSON.parse(String(init.body))]);
    expect(bodies[0]).toEqual(['https://qr.dancewithb.fun/api/ticket.create', { links: ['d', 'e'], name: 'Door sign {code}', parent: 'https://dancewithb.fun', settings: { contrast: '0.56' }, from: 4 }]);
    expect(bodies[1][1]).toMatchObject({ links: ['c'], replace: true, settings: { contrast: '0.56' } });
    // A code made before is in standard colours unless its settings say vivid.
    expect(isVivid({ meta: { settings: { contrast: '0.56' } } })).toBe(true);
    expect(isVivid({ meta: { settings: { contrast: '0.4' } } })).toBe(false);
    expect(isVivid({})).toBe(false);
  });
});

describe("door signs' short links", () => {
  beforeEach(() => {
    process.env.QR_API_TOKEN = 'qra_test';
  });
  afterEach(() => {
    delete process.env.QR_API_TOKEN;
    vi.unstubAllGlobals();
  });

  const link = (code: string, key: string | null, label = 'Door sign (dancewithb.fun)', created_at = 1) => ({ code, short: `https://qr.dancewithb.fun/c/${code}`, url: 'u', label, key, hits: 0, created_at, updated_at: created_at, last_hit: null });

  it('are the door-sign keys plus the first check-in link; anything else on the QR site is left alone', () => {
    expect(isPoolLink(link('a', 'door-sign-3'))).toBe(true);
    expect(isPoolLink(link('c', null, LEGACY_LABEL))).toBe(true);
    expect(isPoolLink(link('x', 'flyer-1'))).toBe(false);
    expect(isPoolLink(link('y', null, 'Spring flyer'))).toBe(false);
  });

  it("a saved sign's link isn't free; a deleted sign's is, and the next new link gets the next key", async () => {
    const links = [link('c', null, LEGACY_LABEL, 1), link('d', 'door-sign-1', undefined, 2), link('e', 'door-sign-2', undefined, 3), link('z', 'flyer', undefined, 4)];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return body.key ? Response.json({ ...link('f', body.key), url: body.url }, { status: 201 }) : Response.json({ links });
    });
    vi.stubGlobal('fetch', fetch);
    db.current = new FakeSupabase().seed('door_signs', [{ id: 's1', link_code: 'c', updated_at: '2026-11-01' }, { id: 's2', link_code: 'e', updated_at: '2026-11-02' }]);
    const pool = await poolLinks();
    expect(pool.links.map((l) => l.code)).toEqual(['c', 'd', 'e']);
    expect(pool.free.map((l) => l.code)).toEqual(['d']);

    const made = await addPoolLink('https://dancewithb.fun/check-in/x', pool.links);
    expect(made.key).toBe('door-sign-3');
  });
  it('reads every link, a page at a time, so the pool never misses one past the first 200', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => link(`l${from + i}`, `door-sign-${from + i + 1}`, undefined, from + i));
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { offset } = JSON.parse(String(init.body));
      return Response.json({ links: offset === 0 ? page(200, 0) : page(3, 200) });
    });
    vi.stubGlobal('fetch', fetch);
    // The saved signs are passed in, so they aren't read a second time.
    const pool = await poolLinks([{ link_code: 'l0' }]);
    expect(pool.links).toHaveLength(203);
    expect(pool.free).toHaveLength(202);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await addPoolLink('u', pool.links).catch(() => null)).toBeTruthy();
    expect(JSON.parse(String((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body)).key).toBe('door-sign-204');
  });

});

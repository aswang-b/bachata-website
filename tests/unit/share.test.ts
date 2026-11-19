import { afterEach, describe, expect, it, vi } from 'vitest';
import { setServerTimeZone } from '../../src/lib/siteTime';
import { shareCaption, type CaptionEvent } from '../../src/lib/shareCaption';
import { previewImageWith, scaleBucketUrl } from '../../src/lib/flyerImage';
import { classShareUrl, shareLink, type ShareNav } from '../../src/scripts/share';
import { createObjectUrlHolder, flyerFileName, seriesOf, shareFlyer, type FlyerNav } from '../../src/scripts/calendar/editor/shareFlyer';
import type { SiteEvent } from '../../src/scripts/calendar/types';

afterEach(() => setServerTimeZone('America/Chicago'));

const abort = () => Object.assign(new Error('closed'), { name: 'AbortError' });
const DATA = { title: 'Bachata Basics', text: 'Bachata Basics · Sat, Aug 8', url: 'https://x.test/register?series=k1' };

describe('a class link', () => {
  it('is the class page for a class and the events page for an event, with the key encoded', () => {
    expect(classShareUrl('https://x.test', 'class', 'k1')).toBe('https://x.test/register?series=k1');
    expect(classShareUrl('https://x.test', 'event', 'a b/c')).toBe('https://x.test/register/events?series=a%20b%2Fc');
  });
});

describe('shareLink', () => {
  it('uses the share sheet when there is one, with the title, text and link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareLink(DATA, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(DATA);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says nothing when the sheet is closed (AbortError), and does not copy', async () => {
    const writeText = vi.fn();
    const nav: ShareNav = { share: vi.fn().mockRejectedValue(abort()), clipboard: { writeText } };
    expect(await shareLink(DATA, nav)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link when the sheet fails any other way', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNav = { share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), clipboard: { writeText } };
    expect(await shareLink(DATA, nav)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it('copies the link when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(DATA, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it('asks for the link to be copied by hand when there is neither, or the clipboard refuses', async () => {
    expect(await shareLink(DATA, {})).toBe('manual');
    expect(await shareLink(DATA, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toBe('manual');
  });
});

// Saturday, Aug 8, 2026, 8:00-9:00 PM Central (CDT, UTC-5).
const klass = (o: Partial<CaptionEvent> = {}): CaptionEvent => ({
  title: 'Bachata Basics',
  event_type: 'class',
  start_time: '2026-08-09T01:00:00Z',
  end_time: '2026-08-09T02:00:00Z',
  location: 'Studio One',
  price_whole_series: 15,
  ...o,
});
const URL_ = 'https://x.test/register?series=k1';
const NOW = new Date('2026-07-01T00:00:00Z');

describe('shareCaption', () => {
  it('one item per line for a single date: name, date and time, venue, price, link', () => {
    expect(shareCaption({ event: klass(), url: URL_, now: NOW })).toBe(
      ['Bachata Basics', 'Sat, Aug 8 · 8:00 PM–9:00 PM', 'Studio One', 'Price: $15', URL_].join('\n')
    );
  });

  it('uses the series wording and its prices', () => {
    const second = klass({ start_time: '2026-08-16T01:00:00Z', end_time: '2026-08-16T02:00:00Z' });
    const caption = shareCaption({
      event: klass({ price_whole_series: 50, price_drop_in: 15 }),
      upcoming: [klass(), second],
      whole: { first: '2026-08-09T01:00:00Z', last: '2026-08-16T01:00:00Z' },
      total: 2,
      url: URL_,
      now: NOW,
    }).split('\n');
    expect(caption[1]).toBe('Saturdays, 8:00 PM–9:00 PM (Aug 8–Aug 15)');
    expect(caption[3]).toBe('Series: $50 · Drop in: $15/class');
  });

  it('names the class\'s city after the venue, and just the city with no venue', () => {
    expect(shareCaption({ event: klass({ city: 'Santa Fe' }), now: NOW }).split('\n')[2]).toBe('Studio One · Santa Fe');
    expect(shareCaption({ event: klass({ city: 'Santa Fe', location: '' }), now: NOW }).split('\n')[2]).toBe('Santa Fe');
  });

  it('leaves out a line with no value: no price, no venue, no link', () => {
    const caption = shareCaption({ event: klass({ price_whole_series: null, location: null }), now: NOW });
    expect(caption).toBe('Bachata Basics\nSat, Aug 8 · 8:00 PM–9:00 PM');
  });

  it('shows the price in force and its tier', () => {
    const early = klass({ price_whole_series_early_bird: 10, early_bird_until: '2026-08-01T00:00:00Z' });
    expect(shareCaption({ event: early, now: NOW }).split('\n')[3]).toBe('Price: $10 (Early Bird)');
    expect(shareCaption({ event: klass({ event_type: 'event', price_whole_series: 20 }), now: NOW }).split('\n')[3]).toBe('Ticket: $20');
  });

  it("gives a Denver class its own zone label when the site's clock differs", () => {
    setServerTimeZone('America/Chicago');
    const caption = shareCaption({ event: klass({ time_zone: 'America/Denver' }), now: NOW });
    expect(caption.split('\n')[1]).toBe('Sat, Aug 8 · 7:00 PM–8:00 PM MT');
  });
});

describe('the flyer picture', () => {
  const bucket = 'https://p.supabase.co/storage/v1/object/public/event-images/';
  it('is asked for as the link preview is: 1200 wide at most, quality 70, a PNG as WebP', () => {
    expect(previewImageWith(`${bucket}a_2000x3000.jpg`, scaleBucketUrl)).toMatchObject({
      url: 'https://p.supabase.co/storage/v1/render/image/public/event-images/a_2000x3000.jpg?width=1200&resize=contain&quality=70',
    });
    expect(previewImageWith(`${bucket}a_800x1000.png`, scaleBucketUrl)!.url).toMatch(/width=800&resize=contain&quality=70&format=webp$/);
  });
  it('names the file by its type', () => {
    expect(flyerFileName('Bachata Basics!', 'image/jpeg')).toBe('bachata-basics.jpg');
    expect(flyerFileName('Bachata Basics', 'image/webp')).toBe('bachata-basics.webp');
  });
});

describe('shareFlyer (admin)', () => {
  const ev = (o: Partial<SiteEvent> = {}) => ({ ...klass(), id: 'e1', google_recurring_event_id: null, visibility: 'public', flyer_url: 'f', ...o }) as unknown as SiteEvent;
  const file = new File(['x'], 'f.jpg', { type: 'image/jpeg' });
  const stubLocation = () => vi.stubGlobal('location', { origin: 'https://x.test' });
  afterEach(() => vi.unstubAllGlobals());

  it('copies the caption first, then shares the file with the caption', async () => {
    stubLocation();
    const order: string[] = [];
    const nav: FlyerNav = {
      clipboard: { writeText: async () => void order.push('copy') },
      canShare: () => true,
      share: async (d) => void order.push(`share:${d.files?.length}:${d.text?.split('\n')[0]}`),
    };
    const out = await shareFlyer(ev(), [], nav, async () => file);
    expect(order).toEqual(['copy', 'share:1:Bachata Basics']);
    expect(out.message).toBe('');
  });

  it('falls back to text and link when files cannot be shared, and to a download with no share sheet', async () => {
    stubLocation();
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await shareFlyer(ev(), [], { clipboard, canShare: () => false, share }, async () => file);
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining('Bachata Basics'), url: 'https://x.test/register?series=e1' });
    const out = await shareFlyer(ev(), [], { clipboard }, async () => file);
    expect(out).toEqual({ message: 'Caption copied', download: file });
  });

  it('is silent when the sheet is closed, and plain when it fails; a class with no flyer shares the caption', async () => {
    stubLocation();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect((await shareFlyer(ev(), [], { clipboard, canShare: () => true, share: vi.fn().mockRejectedValue(abort()) }, async () => file)).message).toBe('');
    expect((await shareFlyer(ev(), [], { clipboard, canShare: () => true, share: vi.fn().mockRejectedValue(new Error('x')) }, async () => file)).message).toMatch(/^Caption copied/);
    const share = vi.fn().mockResolvedValue(undefined);
    await shareFlyer(ev({ flyer_url: null }), [], { clipboard, canShare: () => true, share }, async () => null);
    expect(share.mock.calls[0][0].files).toBeUndefined();
  });

  it('a private class has no link in its caption', async () => {
    stubLocation();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await shareFlyer(ev({ visibility: 'private' }), [], { clipboard }, async () => null);
    expect(clipboard.writeText.mock.calls[0][0]).not.toContain('https://');
  });
});

describe('seriesOf', () => {
  it('finds the upcoming classes and the whole series', () => {
    const mk = (id: string, start: string) => ({ ...klass({ start_time: start, end_time: start }), id, google_recurring_event_id: 's' }) as unknown as SiteEvent;
    const all = [mk('a', '2026-01-01T00:00:00Z'), mk('b', '2026-09-01T00:00:00Z'), mk('c', '2026-09-08T00:00:00Z')];
    const s = seriesOf(all[1], all, Date.parse('2026-08-01T00:00:00Z'));
    expect(s.key).toBe('s');
    expect(s.upcoming.map((e) => e.id)).toEqual(['b', 'c']);
    expect(s.total).toBe(3);
    expect(s.whole).toEqual({ first: '2026-01-01T00:00:00Z', last: '2026-09-08T00:00:00Z' });
  });
});

// The "Download flyer" link's blob address is held by the page until revoked.
describe('createObjectUrlHolder', () => {
  const fakeUrls = () => {
    let n = 0;
    const live = new Set<string>();
    return {
      live,
      createObjectURL: vi.fn(() => {
        const url = `blob:fake/${++n}`;
        live.add(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => void live.delete(url)),
    };
  };
  const blob = new Blob(['x']);

  it('revokes the previous address when a new one is made, so only the newest stays', () => {
    const urls = fakeUrls();
    const holder = createObjectUrlHolder(urls);
    expect(holder.make(blob)).toBe('blob:fake/1');
    expect(holder.make(blob)).toBe('blob:fake/2');
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:fake/1');
    expect([...urls.live]).toEqual(['blob:fake/2']);
  });

  it('revokes the last one when its link is removed, once, and does nothing with none', () => {
    const urls = fakeUrls();
    const holder = createObjectUrlHolder(urls);
    holder.release();
    expect(urls.revokeObjectURL).not.toHaveBeenCalled();
    holder.make(blob);
    holder.release();
    holder.release();
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(urls.live.size).toBe(0);
  });
});

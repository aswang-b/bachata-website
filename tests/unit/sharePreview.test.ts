import { afterEach, describe, expect, it } from 'vitest';
import { setServerTimeZone } from '../../src/lib/siteTime';
import { capOnWord, classSharePreview, previewImage, type PreviewOccurrence } from '../../src/lib/sharePreview';

// A class's own register link previews that class where it is pasted
// (WhatsApp, iMessage, Facebook). The site is in Central here (the tests' default).
afterEach(() => setServerTimeZone('America/Chicago'));

const BUCKET = 'http://supabase.test/storage/v1/object/public/event-images/';
const HOME = { city: 'Madison', state: 'WI', note: '' };

// Saturday, Aug 8, 2026, 8:00-9:00 PM Central (CDT, UTC-5).
const row = (o: Partial<PreviewOccurrence> = {}): PreviewOccurrence => ({
  title: 'Bachata Basics',
  start_time: '2026-08-09T01:00:00Z',
  end_time: '2026-08-09T02:00:00Z',
  location: 'Studio One',
  ...o,
});
const base = { path: '/register', key: 'k1', isEvent: false, home: HOME };

describe('the link preview of a class', () => {
  it('names a one-off class and its date, time, venue and city, titled with the site name', () => {
    const p = classSharePreview({ ...base, rows: [row({ city: 'Santa Fe', state: 'NM' })] })!;
    expect(p.title).toBe('Bachata Basics · Dance with B');
    expect(p.description).toBe('Sat, Aug 8 · 8:00 PM–9:00 PM · Studio One · Santa Fe, NM');
    expect(p.canonical).toBe('/register?series=k1');
  });

  it("describes a series by the site's own sub-label (weekday, times, date range from the whole series)", () => {
    const rows = [row(), row({ start_time: '2026-08-16T01:00:00Z', end_time: '2026-08-16T02:00:00Z' })];
    const p = classSharePreview({ ...base, rows, total: 4, whole: { first: '2026-08-02T01:00:00Z', last: '2026-08-23T01:00:00Z' } })!;
    expect(p.description).toBe('Saturdays, 8:00 PM–9:00 PM (Aug 1–Aug 22) · Studio One · Madison, WI');
  });

  it("falls back to the home city when the class has none, and shows it even when the class is at home", () => {
    expect(classSharePreview({ ...base, rows: [row()] })!.description).toMatch(/ · Madison, WI$/);
    expect(classSharePreview({ ...base, rows: [row({ city: 'MADISON', state: 'WI' })] })!.description).toMatch(/ · Studio One · MADISON, WI$/);
    // A city with no state.
    expect(classSharePreview({ ...base, rows: [row({ city: 'Taos' })] })!.description).toMatch(/ · Taos$/);
  });

  it('leaves out a missing venue', () => {
    const p = classSharePreview({ ...base, rows: [row({ location: null, city: 'Taos', state: 'NM' })] })!;
    expect(p.description).toBe('Sat, Aug 8 · 8:00 PM–9:00 PM · Taos, NM');
  });

  it("shows a Denver class in its own zone, with the zone only off the site's clock", () => {
    const p = classSharePreview({ ...base, rows: [row({ time_zone: 'America/Denver' })] })!;
    expect(p.description).toBe('Sat, Aug 8 · 7:00 PM–8:00 PM MT · Studio One · Madison, WI');
    // On the site's own clock, no label.
    expect(classSharePreview({ ...base, rows: [row({ time_zone: 'America/Chicago' })] })!.description).toContain('8:00 PM–9:00 PM ·');
  });

  it('uses the same date wording for an event, and its own register path', () => {
    const p = classSharePreview({ ...base, path: '/register/events', key: 'a b', isEvent: true, rows: [row()] })!;
    expect(p.description.startsWith('Sat, Aug 8 · 8:00 PM–9:00 PM')).toBe(true);
    expect(p.canonical).toBe('/register/events?series=a%20b');
  });

  it('is nothing for a class with no upcoming dates', () => {
    expect(classSharePreview({ ...base, rows: [] })).toBeNull();
  });

  it('caps the description at 200 characters on a word boundary', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const p = classSharePreview({ ...base, rows: [row({ location: long })] })!;
    expect(p.description.length).toBeLessThanOrEqual(200);
    expect(p.description.endsWith('…')).toBe(true);
    expect(p.description.slice(0, -1)).toMatch(/word\d+$/);
    expect(capOnWord('short')).toBe('short');
    expect(capOnWord('a'.repeat(250)).length).toBe(200);
  });

  it('shows the flyer through the image transforms, sized for previews, with its size and alt text', () => {
    const p = classSharePreview({ ...base, rows: [row({ flyer_url: `${BUCKET}abc_1080x1440.jpg` })] })!;
    expect(p.image).toBe('http://supabase.test/storage/v1/render/image/public/event-images/abc_1080x1440.jpg?width=1080&resize=contain&quality=70');
    expect([p.imageWidth, p.imageHeight]).toEqual([1080, 1440]);
    expect(p.imageAlt).toBe('Flyer for Bachata Basics');
  });

  it('never asks for more than 1200 px, scales the stored height with it, and leaves the size out when the file name has none', () => {
    const big = previewImage(`${BUCKET}abc_2400x3000.jpg`)!;
    expect(big.url).toContain('width=1200&');
    expect([big.width, big.height]).toEqual([1200, 1500]);
    const unknown = previewImage(`${BUCKET}abc.jpg`)!;
    expect(unknown.url).toContain('width=1200&');
    expect(unknown.width).toBeUndefined();
    expect(unknown.height).toBeUndefined();
  });

  it('asks for a PNG flyer as WebP (a PNG is far over WhatsApp\'s size limit), not a JPEG or WebP one', () => {
    expect(previewImage(`${BUCKET}abc_1080x1350.png`)!.url).toContain('&format=webp');
    expect(previewImage(`${BUCKET}abc_1080x1350.jpg`)!.url).not.toContain('format=');
    expect(previewImage(`${BUCKET}abc_1080x1440.webp`)!.url).not.toContain('format=');
  });

  it('keeps the default image (no image fields) for a class without a flyer, and for a flyer that is not a secure link', () => {
    for (const flyer_url of [null, undefined, 'http://elsewhere.test/f.jpg']) {
      const p = classSharePreview({ ...base, rows: [row({ flyer_url })] })!;
      expect(p.image).toBeUndefined();
      expect(p.imageAlt).toBeUndefined();
      expect(p.title).toBe('Bachata Basics · Dance with B');
    }
    expect(previewImage('https://elsewhere.test/f.jpg')).toEqual({ url: 'https://elsewhere.test/f.jpg' });
  });
});

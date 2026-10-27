import { describe, expect, it } from 'vitest';
import { eventImagePath, flyerSize, flyerSrcset, isEventImageUrl, scaledImageUrl } from '../../src/lib/eventImages';

// setup.ts points Supabase at http://supabase.test.
const BUCKET = 'http://supabase.test/storage/v1/object/public/event-images/';

describe('event images and flyers', () => {
  it("only accepts this site's own uploads as an event image or flyer (they're shown on the public homepage)", () => {
    expect(isEventImageUrl(`${BUCKET}f75d9283-8381-43e8-94ac-a526a9d86e6c_1600x2000.jpg`)).toBe(true);
    expect(isEventImageUrl('https://tracker.example/pixel.gif')).toBe(false);
    expect(isEventImageUrl(`http://evil.test/storage/v1/object/public/event-images/x.jpg`)).toBe(false);
    expect(isEventImageUrl(`${BUCKET}../other-bucket/x.jpg`)).toBe(false);
    expect(isEventImageUrl(`${BUCKET}x.jpg?onerror=1`)).toBe(false);
    expect(isEventImageUrl(42)).toBe(false);
  });

  it("reads a flyer's pixel size from its file name, so its space is reserved before it loads", () => {
    expect(eventImagePath('abc', 'png', { width: 1600, height: 2000 })).toBe('abc_1600x2000.png');
    expect(eventImagePath('abc', 'png')).toBe('abc.png');
    expect(flyerSize(`${BUCKET}abc_1600x2000.png`)).toEqual({ width: 1600, height: 2000 });
    expect(flyerSize(`${BUCKET}abc.png`)).toBeNull();
  });

  it('serves flyers scaled to the column, never scaled up', () => {
    expect(scaledImageUrl(`${BUCKET}abc.jpg`, 400)).toBe('http://supabase.test/storage/v1/render/image/public/event-images/abc.jpg?width=400&resize=contain');
    expect(scaledImageUrl('/local.jpg', 400)).toBe('/local.jpg');
    expect(flyerSrcset(`${BUCKET}abc.jpg`)!.split(', ').map((c) => c.split(' ')[1])).toEqual(['400w', '800w', '1200w']);
    expect(flyerSrcset('/icon-512.png')).toBeUndefined();
    // A 900px-wide flyer: 400 and 800 scaled, then the original.
    expect(flyerSrcset(`${BUCKET}abc_900x1200.jpg`)!.split(', ')).toEqual([
      expect.stringContaining('width=400'),
      expect.stringContaining('width=800'),
      `${BUCKET}abc_900x1200.jpg 900w`,
    ]);
  });
});

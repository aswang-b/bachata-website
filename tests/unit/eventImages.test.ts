import { describe, expect, it } from 'vitest';
import { eventImagePath, flyerSize, flyerSrcset, galleryImageAttrs, isEventImageUrl, scaledImageUrl } from '../../src/lib/eventImages';

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
    // A 900px-wide flyer: 400 and 800 scaled, then 900 scaled too (never the raw original).
    const narrow = flyerSrcset(`${BUCKET}abc_900x1200.jpg`)!;
    expect(narrow.split(', ')).toEqual([
      expect.stringContaining('width=400&resize=contain 400w'),
      expect.stringContaining('width=800&resize=contain 800w'),
      expect.stringContaining('width=900&resize=contain 900w'),
    ]);
    expect(narrow).not.toContain('/object/public/');
    // A 1080px flyer: the top candidate is its own width, and nothing is wider than the flyer.
    const phone = flyerSrcset(`${BUCKET}abc_1080x1440.jpg`)!.split(', ');
    expect(phone.map((c) => c.split(' ')[1])).toEqual(['400w', '800w', '1080w']);
    // A flyer already 1200px or wider keeps the three standard widths.
    expect(flyerSrcset(`${BUCKET}abc_1600x2000.jpg`)!.split(', ').map((c) => c.split(' ')[1])).toEqual(['400w', '800w', '1200w']);
    expect(flyerSrcset(`${BUCKET}abc_1200x1500.jpg`)!.split(', ').map((c) => c.split(' ')[1])).toEqual(['400w', '800w', '1200w']);
    // A tiny flyer is offered at its own width only.
    expect(flyerSrcset(`${BUCKET}abc_300x400.jpg`)).toBe(`http://supabase.test/storage/v1/render/image/public/event-images/abc_300x400.jpg?width=300&resize=contain 300w`);
  });

  it('serves the past-flyer row scaled to how big it shows, with its space reserved when the size is stored', () => {
    const sized = galleryImageAttrs(`${BUCKET}abc_1080x1440.jpg`);
    expect(sized.width).toBe(1080);
    expect(sized.height).toBe(1440);
    expect(sized.srcset!.split(', ').map((c) => c.split(' ')[1])).toEqual(['320w', '480w', '640w', '800w']);
    expect(sized.srcset).not.toContain('/object/public/');
    expect(sized.src).toContain('width=640');
    // 256px tall on a phone, 320px from 640px wide, at a 3:4 picture.
    expect(sized.sizes).toBe('(min-width: 640px) 240px, 192px');
    // Never wider than the picture itself.
    expect(galleryImageAttrs(`${BUCKET}abc_500x700.jpg`).srcset!.split(', ').map((c) => c.split(' ')[1])).toEqual(['320w', '480w', '500w']);
    // No stored size (older uploads): no width/height, and `sizes` covers the widest (square) flyer.
    const plain = galleryImageAttrs(`${BUCKET}abc.jpg`);
    expect(plain.width).toBeUndefined();
    expect(plain.sizes).toBe('(min-width: 640px) 320px, 256px');
    expect(plain.srcset).toContain('/render/image/');
    // Outside the bucket: as it is.
    expect(galleryImageAttrs('/local.jpg')).toEqual({ src: '/local.jpg' });
  });
});

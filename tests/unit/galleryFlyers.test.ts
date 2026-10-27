import { describe, expect, it } from 'vitest';
import { isGalleryFlyerUrl } from '../../src/lib/homepageContent';

describe('past flyers gallery', () => {
  const bucket = `${process.env.SUPABASE_URL}/storage/v1/object/public/event-images/`;

  it('accepts only images uploaded to the event-images bucket', () => {
    expect(isGalleryFlyerUrl(`${bucket}3f2a9c1e-flyer.jpg`)).toBe(true);
    expect(isGalleryFlyerUrl('https://example.com/flyer.jpg')).toBe(false);
    expect(isGalleryFlyerUrl(`${bucket}../other-bucket/x.jpg`)).toBe(false);
    expect(isGalleryFlyerUrl(`${bucket}flyer.jpg"onerror="x`)).toBe(false);
    expect(isGalleryFlyerUrl(42)).toBe(false);
  });
});

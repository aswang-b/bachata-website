import { describe, expect, it } from 'vitest';
import { previewImageWith, scaleBucketUrl } from '../../src/lib/flyerImage';

describe('the flyer picture for link previews', () => {
  const bucket = 'https://p.supabase.co/storage/v1/object/public/event-images/';
  it('is 1200 wide at most, quality 70, a PNG as WebP', () => {
    expect(previewImageWith(`${bucket}a_2000x3000.jpg`, scaleBucketUrl)).toMatchObject({
      url: 'https://p.supabase.co/storage/v1/render/image/public/event-images/a_2000x3000.jpg?width=1200&resize=contain&quality=70',
    });
    expect(previewImageWith(`${bucket}a_800x1000.png`, scaleBucketUrl)!.url).toMatch(/width=800&resize=contain&quality=70&format=webp$/);
  });
});

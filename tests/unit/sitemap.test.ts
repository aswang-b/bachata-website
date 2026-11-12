import { describe, expect, it } from 'vitest';
import { GET } from '../../src/pages/sitemap.xml';

describe('sitemap.xml', () => {
  it('lists the homepage but not /about (it returns when the page has real content)', async () => {
    const xml = await (await GET()).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    expect(locs).toContain('/');
    expect(locs).not.toContain('/about');
  });
});

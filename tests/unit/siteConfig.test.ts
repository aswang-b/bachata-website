import { describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import { loadSiteTimeZone } from '../../src/lib/siteConfig';

describe('loading the site time zone', () => {
  it("a failed read keeps the saved zone instead of switching the site to the default for a minute", async () => {
    vi.useFakeTimers();
    try {
      db.current = new FakeSupabase().seed('site_config', [{ id: true, time_zone: 'America/New_York' }]);
      expect(await loadSiteTimeZone()).toBe('America/New_York');

      // The cache has run out and Supabase has a hiccup.
      vi.advanceTimersByTime(61_000);
      db.current.failNext.set('site_config.select', { message: 'timeout' });
      expect(await loadSiteTimeZone()).toBe('America/New_York');

      // The next request reads it again rather than serving a cached failure.
      db.current.rows('site_config')[0].time_zone = 'America/Denver';
      expect(await loadSiteTimeZone()).toBe('America/Denver');
    } finally {
      vi.useRealTimers();
    }
  });
});

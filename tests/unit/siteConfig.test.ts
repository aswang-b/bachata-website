import { describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import { cleanWhatsappUrl, loadSiteTimeZone, loadWhatsappUrl, saveWhatsappUrl } from '../../src/lib/siteConfig';
import { buildRegistrationConfirmationEmailHtml } from '../../src/lib/registrationEmail';

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

describe('the WhatsApp community link', () => {
  it('takes only https WhatsApp links (community invites, wa.me)', () => {
    expect(cleanWhatsappUrl(' https://chat.whatsapp.com/AbC123 ')).toBe('https://chat.whatsapp.com/AbC123');
    expect(cleanWhatsappUrl('https://wa.me/15555550100')).toBe('https://wa.me/15555550100');
    expect(cleanWhatsappUrl('https://whatsapp.com/channel/x')).toBe('https://whatsapp.com/channel/x');
    for (const bad of ['http://chat.whatsapp.com/x', 'https://chat.whatsapp.com.evil.example/x', 'https://evilwhatsapp.com/x', 'javascript:alert(1)', 'https://user@chat.whatsapp.com/x', 'https://chat.whatsapp.com:8443/x', 'chat.whatsapp.com/x', '', 42]) {
      expect(cleanWhatsappUrl(bad), String(bad)).toBeNull();
    }
  });

  it('is saved, cleared, and kept through a failed read; a non-WhatsApp link is refused', async () => {
    vi.useFakeTimers();
    try {
      db.current = new FakeSupabase().seed('site_config', [{ id: true, time_zone: 'America/Chicago', whatsapp_url: null }]);
      await expect(saveWhatsappUrl('https://example.com/group')).rejects.toThrow('isn’t a WhatsApp link');
      expect(await saveWhatsappUrl('https://chat.whatsapp.com/AbC123')).toBe('https://chat.whatsapp.com/AbC123');
      expect(db.current.rows('site_config')[0].whatsapp_url).toBe('https://chat.whatsapp.com/AbC123');
      // Saving doesn't touch the time zone.
      expect(db.current.rows('site_config')[0].time_zone).toBe('America/Chicago');

      vi.advanceTimersByTime(61_000);
      db.current.failNext.set('site_config.select', { message: 'timeout' });
      expect(await loadWhatsappUrl()).toBe('https://chat.whatsapp.com/AbC123');

      expect(await saveWhatsappUrl('  ')).toBeNull();
      expect(await loadWhatsappUrl()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts a Join button above the reminders in the confirmation email, only when a link is set', () => {
    const base = { registrationTypeLabel: 'Group Lesson', createdAt: new Date('2026-11-06T18:00:00Z'), summaryRows: [] as [string, string][], subtotal: null, faqs: [{ question: 'What to bring?', answer: 'Water.' }] };
    const without = buildRegistrationConfirmationEmailHtml(base);
    expect(without).not.toContain('WhatsApp');
    const html = buildRegistrationConfirmationEmailHtml({ ...base, whatsappUrl: 'https://chat.whatsapp.com/AbC123' });
    expect(html).toContain('href="https://chat.whatsapp.com/AbC123"');
    expect(html).toContain('Join Our WhatsApp Community');
    // A hosted PNG icon (email apps drop SVG), above the reminders.
    expect(html).toContain('https://dancewithb.fun/whatsapp-icon.png');
    expect(html.indexOf('Join Our WhatsApp Community')).toBeLessThan(html.indexOf('What to bring?'));
  });
});

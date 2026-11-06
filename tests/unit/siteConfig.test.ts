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

  it("is set in the site's look: dark header and footer, WhatsApp in the footer only when a link is set, contacts as red links", () => {
    const base = { registrationTypeLabel: 'Group Lesson', createdAt: new Date('2026-11-06T18:00:00Z'), summaryRows: [['Jamie Rivera', 'leader · (555) 555-0100 · jamie@example.com']] as [string, string][], subtotal: null, faqs: [{ question: 'What to bring?', answer: 'Water.' }] };
    const without = buildRegistrationConfirmationEmailHtml(base);
    expect(without).not.toContain('whatsapp');
    // The header (wordmark and heading) and footer bands, with Instagram and Spotify.
    expect(without).toContain('bgcolor="#170f0d"');
    expect(without).toContain('Dance with <span style="color:#ff5577;">B</span>');
    expect(without).toContain('https://dancewithb.fun/email/instagram.png');
    expect(without).not.toContain('Join Our WhatsApp Community');
    expect(without).toContain('<a href="mailto:jamie@example.com"');
    expect(without).toContain('<a href="tel:5555550100"');

    const html = buildRegistrationConfirmationEmailHtml({ ...base, whatsappUrl: 'https://chat.whatsapp.com/AbC123' });
    expect(html).toContain('href="https://chat.whatsapp.com/AbC123"');
    // A hosted PNG icon (email apps drop SVG), in the footer after the reminders.
    expect(html).toContain('https://dancewithb.fun/email/whatsapp.png');
    expect(html.indexOf('email/whatsapp.png')).toBeGreaterThan(html.indexOf('What to bring?'));
  });
});

describe('the confirmation email', () => {
  it("links only the contact lines (a date in a dancer's notes isn't a phone number), and escapes its heading", async () => {
    const { emailLayout } = await import('../../src/lib/emailLayout');
    const html = buildRegistrationConfirmationEmailHtml({
      registrationTypeLabel: 'Group Lesson',
      createdAt: new Date('2026-11-06T18:00:00Z'),
      summaryRows: [['Phone', '(555) 555-0100'], ['Notes', "Can't make 2026-11-13, call 555 555 0199"], ['Class', 'Bachata 2026-11-20 0800-0900']],
      subtotal: null,
      faqs: [],
    });
    expect(html).toContain('<a href="tel:5555550100"');
    expect(html).not.toContain('tel:20261113');
    expect(html).not.toContain('tel:5555550199');
    expect(html).not.toContain('tel:2026');
    expect(emailLayout({ heading: 'Bachata <a href="https://evil.example">x</a>', bodyHtml: '' })).not.toContain('<a href="https://evil.example">');
  });
});

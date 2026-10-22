import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  DEFAULT_QUICK_COLORS,
  eventBannerBg,
  eventBannerStyle,
  eventColorHex,
  eventColorOnDark,
  eventPillStyle,
  eventTextOn,
  GOOGLE_EVENT_COLORS,
  isValidEventColor,
  luminance,
  NAMED_EVENT_COLORS,
  nearestGoogleColorId,
  recentEventColors,
} from '../../src/lib/eventColors';
import { siteColorToGoogleColorId } from '../../src/lib/googleCalendar';

describe('event colors', () => {
  it('accepts the original named colors and any #rrggbb, nothing else', () => {
    for (const ok of ['green', 'accent', '#12ABef']) expect(isValidEventColor(ok)).toBe(true);
    for (const bad of ['#fff', 'rgb(1,2,3)', 'teal', '', null, '#12abeg']) expect(isValidEventColor(bad)).toBe(false);
  });

  it("rejects names every object inherits (they'd be stored and drawn as a function)", () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isValidEventColor(bad)).toBe(false);
      expect(eventColorHex(bad)).toBe('#ff5577');
    }
  });

  it('turns any stored color into a hex, falling back to the site accent', () => {
    expect(eventColorHex('blue')).toBe('#3b82f6');
    expect(eventColorHex('#12ABEF')).toBe('#12abef');
    expect(eventColorHex('nonsense')).toBe('#ff5577');
    expect(eventColorHex(null)).toBe('#ff5577');
  });

  it('keeps white text on every original color, and switches to dark text on light picks', () => {
    for (const name of ['green', 'blue', 'red', 'orange', 'purple', 'accent', 'yellow']) expect(eventTextOn(name)).toBe('#ffffff');
    expect(eventTextOn('#ffe4ec')).toBe('#1c1210');
    expect(eventTextOn('#fef08a')).toBe('#1c1210');
  });

  it('draws every banner and pill with text that meets WCAG AA contrast (4.5:1), whatever color is picked', () => {
    // The stock green, and a mid-tone pick, used to get white text at about 2:1.
    const picks = [...Object.keys(NAMED_EVENT_COLORS), '#9aa7ff', '#7fd1c8', '#ffe4ec', '#101030', '#ffffff', '#000000', '#808080'];
    for (const color of picks) {
      expect(contrastRatio(eventBannerBg(color), eventTextOn(color)), color).toBeGreaterThanOrEqual(4.5);
      const [, bg, text] = eventPillStyle(color).match(/background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6})/)!;
      expect(contrastRatio(bg, text), `pill ${color}`).toBeGreaterThanOrEqual(4.5);
    }
    // A color that already passes is drawn as picked.
    expect(eventBannerBg('#1d4ed8')).toBe('#1d4ed8');
    expect(eventBannerBg('#ffe4ec')).toBe('#ffe4ec');
    expect(eventBannerStyle('green')).not.toContain('#22c55e');
  });

  it('lifts very dark picks so they still read as text on the dark site', () => {
    expect(luminance(eventColorOnDark('#101030'))).toBeGreaterThan(luminance('#101030'));
    expect(eventColorOnDark('#3b82f6')).toBe('#3b82f6');
  });

  it("maps a picked color to Google's closest one, and Google's own colors to themselves", () => {
    for (const [id, hex] of Object.entries(GOOGLE_EVENT_COLORS)) expect(nearestGoogleColorId(hex)).toBe(id);
    expect(nearestGoogleColorId('#ff0000')).toBe('11');
    expect(nearestGoogleColorId('#00a0ff')).toBe('7');
    // Named colors keep their original mapping.
    expect(siteColorToGoogleColorId('green')).toBe('10');
    expect(siteColorToGoogleColorId('#0b8043')).toBe('10');
  });

  it('offers the five most recently used colors, newest first, without repeats, topped up with defaults', () => {
    const events = [
      { color: 'green', updated_at: '2026-10-01T00:00:00Z' },
      { color: '#123456', updated_at: '2026-10-05T00:00:00Z' },
      { color: '#22C55E', updated_at: '2026-10-03T00:00:00Z' },
      { color: '#123456', updated_at: '2026-10-04T00:00:00Z' },
    ];
    expect(recentEventColors(events)).toEqual(['#123456', '#22c55e', ...DEFAULT_QUICK_COLORS.filter((c) => c !== '#22c55e').slice(0, 3)]);
    expect(recentEventColors([])).toEqual(DEFAULT_QUICK_COLORS);
  });
});

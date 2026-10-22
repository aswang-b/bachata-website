// Pure — safe for SSR frontmatter and browser scripts alike.
//
// An event's color is either one of the original named colors ('green',
// 'blue', …, still on older events) or any "#rrggbb" picked in the editor's
// color picker. Everything that draws an event's color goes through here, so
// both kinds look the same everywhere.

export const NAMED_EVENT_COLORS: Record<string, string> = {
  green: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316',
  purple: '#c084fc',
  accent: '#ff5577',
  yellow: '#eab308',
};

// The editor's quick picks when there aren't 5 recently used colors yet.
export const DEFAULT_QUICK_COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#f97316', '#c084fc'];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidEventColor(color: unknown): color is string {
  // Own keys only: `in` would also accept inherited names like "constructor".
  return typeof color === 'string' && (Object.hasOwn(NAMED_EVENT_COLORS, color) || HEX_RE.test(color));
}

// The color as "#rrggbb" (lowercase); unknown or missing → the site accent.
export function eventColorHex(color: string | null | undefined): string {
  if (color && HEX_RE.test(color)) return color.toLowerCase();
  return color && Object.hasOwn(NAMED_EVENT_COLORS, color) ? NAMED_EVENT_COLORS[color] : NAMED_EVENT_COLORS.accent;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG relative luminance, 0 (black) to 1 (white).
export function luminance(hex: string): number {
  const [r, g, b] = rgb(eventColorHex(hex)).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Text on a colored banner: white, except on light colors (pastels, yellows)
// where it would be hard to read. The original named colors all keep white.
export function eventTextOn(color: string | null | undefined): string {
  return luminance(eventColorHex(color)) > 0.55 ? '#1c1210' : '#ffffff';
}

// WCAG contrast ratio between two colors, 1 to 21.
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function scale(hex: string, factor: number): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// The background a banner actually uses behind eventTextOn's text: the color
// itself when the two meet WCAG AA (4.5:1), otherwise the color darkened step
// by step until white text does, like the -600/-700 shades the named colors
// used to be drawn in. Light colors get dark text, which always passes.
export function eventBannerBg(color: string | null | undefined): string {
  let hex = eventColorHex(color);
  const text = eventTextOn(hex);
  while (contrastRatio(hex, text) < 4.5) hex = scale(hex, 0.92);
  return hex;
}

// The color used as text on the site's dark background: very dark picks are
// lifted toward white so labels like "Class" stay readable.
export function eventColorOnDark(color: string | null | undefined): string {
  const hex = eventColorHex(color);
  if (luminance(hex) >= 0.12) return hex;
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (255 - c) * 0.5));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Inline styles, for markup that used to use a class per named color.
export const eventDotStyle = (color: string | null | undefined) => `background-color: ${eventColorHex(color)}`;
export const eventBannerStyle = (color: string | null | undefined) => `background-color: ${eventBannerBg(color)}; color: ${eventTextOn(color)}`;
// A badge over a photo (homepage card pills): the color darkened a step first
// so it stands out from the photo, then made readable like a banner.
export function eventPillStyle(color: string | null | undefined): string {
  const hex = scale(eventColorHex(color), 0.82);
  return `background-color: ${eventBannerBg(hex)}; color: ${eventTextOn(hex)}`;
}
export const eventTextStyle = (color: string | null | undefined) => `color: ${eventColorOnDark(color)}`;

// Google Calendar's fixed event colors (colorId → color), for matching a
// picked color to the closest one Google can show.
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

// The Google colorId closest to a "#rrggbb" color (weighted RGB distance,
// which tracks how different two colors look better than plain RGB).
export function nearestGoogleColorId(hex: string): string {
  const [r1, g1, b1] = rgb(eventColorHex(hex));
  let best = '4';
  let bestDistance = Infinity;
  for (const [id, googleHex] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const [r2, g2, b2] = rgb(googleHex);
    const rMean = (r1 + r2) / 2;
    const distance = (2 + rMean / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rMean) / 256) * (b1 - b2) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

// The most recently used colors (newest first, no repeats), topped up with
// the defaults so there are always `count` quick picks.
export function recentEventColors(events: { color: string | null; updated_at?: string | null; start_time?: string }[], count = 5): string[] {
  const byRecency = [...events].sort((a, b) => Date.parse(b.updated_at ?? b.start_time ?? '') - Date.parse(a.updated_at ?? a.start_time ?? ''));
  const colors: string[] = [];
  for (const e of byRecency) {
    const hex = eventColorHex(e.color);
    if (!colors.includes(hex)) colors.push(hex);
    if (colors.length === count) return colors;
  }
  for (const hex of DEFAULT_QUICK_COLORS) {
    if (colors.length === count) break;
    if (!colors.includes(hex)) colors.push(hex);
  }
  return colors;
}

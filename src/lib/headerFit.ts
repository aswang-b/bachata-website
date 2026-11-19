// Server-side. Which header layout shows at which screen width, worked out
// while the page renders from the links and buttons it will hold, so CSS alone
// shows the right one from the first frame (components/Header.astro): no
// script measures after the page shows, and the font (fallback or web font)
// doesn't matter.
//
// The widths are those of the site's own fonts (Inter, Poppins), which are
// wider than the fallbacks, rounded up; tests/e2e/header-stable.spec.ts checks
// them against the real header in both. Each layout must fit with SPARE extra
// (and the bell counted even where a browser without push drops it).

// A nav link's width at text-sm uppercase tracking-wider; an unknown label is
// costed per character, generously.
export const LINK_WIDTH: Record<string, number> = { Home: 46, About: 54, Calendar: 82, Contact: 74, 'Check In': 74 };
const linkWidth = (label: string) => LINK_WIDTH[label] ?? Math.ceil(label.length * 11 + 2);

// Register buttons [long label, short label], by size (below / from 768px).
export const BUTTON_WIDTH = {
  small: { classes: [159, 75], events: [153, 68] },
  large: { classes: [190, 94], events: [182, 86] },
} as const;
export const LOGO_WIDTH = { small: 115, large: 128 } as const; // text-lg below 640px, text-xl from 640
const ICON = 24; // the bell, and the menu button
const NAV_GAP = 32; // gap-8
const ROW_MAX = 1152; // max-w-6xl, padding included: the row stops growing at a 1152px screen
export const SPARE = 0.04;

export interface Tier {
  min: number;
  max: number;
  pad: number;
  rowGap: number;
  logo: number;
  actionsGap: number;
  buttons: (typeof BUTTON_WIDTH)['small' | 'large'];
  nav: boolean;
}
// Tailwind's sm (640) and md (768): padding, gaps, logo and buttons change there; the nav links only show from md.
export const TIERS: Tier[] = [
  { min: 0, max: 639, pad: 32, rowGap: 12, logo: LOGO_WIDTH.small, actionsGap: 8, buttons: BUTTON_WIDTH.small, nav: false },
  { min: 640, max: 767, pad: 48, rowGap: 16, logo: LOGO_WIDTH.large, actionsGap: 8, buttons: BUTTON_WIDTH.small, nav: false },
  { min: 768, max: Infinity, pad: 48, rowGap: 16, logo: LOGO_WIDTH.large, actionsGap: 16, buttons: BUTTON_WIDTH.large, nav: true },
];

export interface HeaderContent {
  navLabels: string[];
  showEvents: boolean;
}
export type HeaderState = 'compact-short' | 'compact-long' | 'full-short' | 'full-long';
// From least to most wanted: the header shows the most wanted one that fits.
export const STATES: HeaderState[] = ['compact-short', 'compact-long', 'full-short', 'full-long'];

// Width the row's content needs in a state (the grid's three columns and two
// gaps; compact leaves the middle one empty but keeps its gap).
export function contentWidth(tier: Tier, content: HeaderContent, state: HeaderState): number {
  const full = state.startsWith('full');
  const long = state.endsWith('long') ? 0 : 1;
  const buttons = [tier.buttons.classes[long], ...(content.showEvents ? [tier.buttons.events[long]] : [])];
  const icons = full ? [ICON] : [ICON, ICON];
  const items = [...buttons, ...icons];
  const actions = items.reduce((a, b) => a + b, 0) + tier.actionsGap * (items.length - 1);
  const labels = content.navLabels;
  const nav = full ? labels.reduce((a, l) => a + linkWidth(l), 0) + NAV_GAP * Math.max(0, labels.length - 1) : 0;
  return tier.logo + 2 * tier.rowGap + nav + actions;
}

// The narrowest screen width in each tier where a state fits, if any.
export function stateRanges(content: HeaderContent): { state: HeaderState; from: number; to: number }[] {
  const ranges: { state: HeaderState; from: number; to: number }[] = [];
  for (const tier of TIERS) {
    for (const state of STATES) {
      if (state.startsWith('full') && !tier.nav) continue;
      if (state === 'compact-short') continue; // the default everywhere
      const room = Math.ceil(contentWidth(tier, content, state) * (1 + SPARE));
      if (room > ROW_MAX - tier.pad) continue;
      const from = Math.max(tier.min, room + tier.pad);
      if (from <= tier.max) ranges.push({ state, from, to: tier.max });
    }
  }
  return ranges;
}

// The header's CSS: the menu and short labels by default, then each larger
// state from the width it fits at. Later rules win, so within a tier they go
// from least to most wanted. data-fit (set by the header's script, only when
// the row really doesn't fit: an admin's extra links) overrides all of it.
export function headerCss(content: HeaderContent): string {
  const full = '#site-header:not([data-fit~="compact"])';
  const rules: Record<HeaderState, string> = {
    'compact-short': '',
    'compact-long': '#site-header .register-label-full{display:inline}#site-header .register-label-short{display:none}',
    'full-short': `${full} #desktop-nav{display:flex}${full} #nav-toggle,${full} #mobile-nav{display:none}#site-header .register-label-full{display:none}#site-header .register-label-short{display:inline}`,
    'full-long': `${full} #desktop-nav{display:flex}${full} #nav-toggle,${full} #mobile-nav{display:none}#site-header .register-label-full{display:inline}#site-header .register-label-short{display:none}`,
  };
  const media = stateRanges(content).map(({ state, from, to }) => {
    const query = Number.isFinite(to) ? `(min-width:${from}px) and (max-width:${to + 0.98}px)` : `(min-width:${from}px)`;
    return `@media ${query}{${rules[state]}}`;
  });
  return ['#site-header #desktop-nav,#site-header .register-label-full{display:none}', ...media].join('\n');
}

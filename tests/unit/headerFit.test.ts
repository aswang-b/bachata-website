import { describe, expect, it } from 'vitest';
import { contentWidth, headerCss, SPARE, stateRanges, TIERS, type HeaderContent, type HeaderState } from '../../src/lib/headerFit';

// The header's layout by screen width (src/lib/headerFit.ts), worked out from
// the links and buttons the page renders. tests/e2e/header-stable.spec.ts
// checks the widths against the real header.
const LIVE: HeaderContent = { navLabels: ['Home', 'Calendar', 'Contact'], showEvents: true };
const ALL: HeaderContent = { navLabels: ['Home', 'About', 'Calendar', 'Contact', 'Check In'], showEvents: true };

const at = (content: HeaderContent, width: number) => {
  let state: HeaderState = 'compact-short';
  for (const r of stateRanges(content)) if (width >= r.from && width <= r.to) state = r.state;
  return state;
};

describe('header layout by screen width', () => {
  it('three links and both buttons: menu + short on phones, long labels from 576, nav links from 768, long again from 937', () => {
    expect(at(LIVE, 360)).toBe('compact-short');
    expect(at(LIVE, 390)).toBe('compact-short');
    expect(at(LIVE, 575)).toBe('compact-short');
    expect(at(LIVE, 576)).toBe('compact-long');
    expect(at(LIVE, 767)).toBe('compact-long');
    expect(at(LIVE, 768)).toBe('full-short');
    expect(at(LIVE, 936)).toBe('full-short');
    expect(at(LIVE, 937)).toBe('full-long');
    expect(at(LIVE, 1024)).toBe('full-long');
    expect(at(LIVE, 1280)).toBe('full-long');
    expect(at(LIVE, 2560)).toBe('full-long');
  });

  it('every link showing needs more room before the nav links come out of the menu', () => {
    const fullFrom = stateRanges(ALL).find((r) => r.state === 'full-short')!.from;
    expect(fullFrom).toBeGreaterThan(768);
    expect(at(ALL, 768)).toBe('compact-long');
    expect(at(ALL, fullFrom - 1)).toBe('compact-long');
    expect(at(ALL, fullFrom)).toBe('full-short');
    expect(at(ALL, 1280)).toBe('full-long');
  });

  it('every state it picks fits its row with room to spare, at every width', () => {
    for (const content of [LIVE, ALL, { navLabels: ['Home'], showEvents: false }, { ...ALL, showEvents: false }]) {
      for (let width = 320; width <= 1600; width += 1) {
        const state = at(content, width) as HeaderState;
        if (state === 'compact-short') continue; // the default, as narrow as the header gets
        const tier = TIERS.find((t) => width >= t.min && width <= t.max)!;
        const room = Math.min(width, 1152) - tier.pad;
        expect(contentWidth(tier, content, state) * (1 + SPARE), `${width}px ${state}`).toBeLessThanOrEqual(room);
      }
    }
  });

  it('a long unknown label is costed generously rather than not at all', () => {
    const wide = stateRanges({ navLabels: ['Home', 'Workshops and Socials'], showEvents: true }).find((r) => r.state === 'full-long')!.from;
    const narrow = stateRanges({ navLabels: ['Home'], showEvents: true }).find((r) => r.state === 'full-long')!.from;
    expect(wide - narrow).toBeGreaterThan(200);
  });

  it('the CSS defaults to the menu with short labels and lets data-fit override the layout', () => {
    const css = headerCss(LIVE);
    expect(css.split('\n')[0]).toBe('#site-header #desktop-nav,#site-header .register-label-full{display:none}');
    expect(css).toContain('@media (min-width:576px) and (max-width:639.98px)');
    expect(css).toContain('@media (min-width:937px){');
    expect(css).toContain('#site-header:not([data-fit~="compact"]) #desktop-nav{display:flex}');
    // Plain CSS only: nothing from the page's text ends up in it.
    expect(headerCss({ navLabels: ['</style><script>'], showEvents: false })).not.toContain('<');
  });
});

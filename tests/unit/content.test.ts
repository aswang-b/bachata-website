import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));

import { guidelineSections, hasGuidelines, sanitizeGuidelinesHtml } from '../../src/lib/communityGuidelines';
import { sanitizeEventDescriptionHtml, sanitizeRichHtml } from '../../src/lib/richText';
import { normalizeLessonOverviewOverride } from '../../src/lib/homepageContent';

describe('community guidelines', () => {
  it('splits at each heading into FAQ-style items, keeping text before the first heading as an untitled block', () => {
    expect(guidelineSections('<div>Intro</div><h3>Consent</h3><div>Ask first.</div><h3><b>Hygiene</b></h3><ul><li>Mints</li></ul>')).toEqual([
      { title: null, body: '<div>Intro</div>' },
      { title: 'Consent', body: '<div>Ask first.</div>' },
      { title: 'Hygiene', body: '<ul><li>Mints</li></ul>' },
    ]);
  });

  it('treats text with no headings as one untitled block, and drops empty headings', () => {
    expect(guidelineSections('<div>Just text</div>')).toEqual([{ title: null, body: '<div>Just text</div>' }]);
    expect(guidelineSections('<h3><br></h3><h3>Real</h3><div>x</div>')).toEqual([{ title: 'Real', body: '<div>x</div>' }]);
  });

  it('counts a cleared editor (only <br>/&nbsp;) as blank, so the event form asks for no agreement', () => {
    expect(hasGuidelines('<div><br></div>&nbsp;')).toBe(false);
    expect(hasGuidelines('<h3>Be kind</h3>')).toBe(true);
  });

  it('keeps headings and lists but strips scripts, handlers and attributes', () => {
    const out = sanitizeGuidelinesHtml('<h3 style="color:red" onclick="x()">Title</h3><script>alert(1)</script><img src=x onerror=alert(1)><ul><li>ok</li></ul>');
    expect(out).toBe('<h3>Title</h3><ul><li>ok</li></ul>');
  });
});

describe('rich text sanitizer', () => {
  it('only allows http(s) and site-relative links, and forces them to open safely', () => {
    expect(sanitizeEventDescriptionHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeEventDescriptionHtml('<a href="https://dancewithb.fun">x</a>')).toBe('<a href="https://dancewithb.fun" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeEventDescriptionHtml("<a href='/register'>x</a>")).toContain('href="/register"');
  });

  it('drops disallowed tags but keeps their text', () => {
    expect(sanitizeRichHtml('<iframe src="x"></iframe><b>bold</b><style>p{}</style>', new Set(['B']))).toBe('<b>bold</b>');
  });
});

describe('homepage lesson overview override', () => {
  it('treats a cleared header/body as "use the default"', () => {
    expect(normalizeLessonOverviewOverride('  ', '<div><br></div>')).toEqual({ title: null, body: null });
    expect(normalizeLessonOverviewOverride('Format', '<p>Hi</p>')).toEqual({ title: 'Format', body: '<p>Hi</p>' });
  });
});

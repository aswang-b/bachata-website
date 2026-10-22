import { describe, expect, it } from 'vitest';
import { escapeAttr, locationHref } from '../../src/lib/locationLink';

describe('location links', () => {
  it('links a web address to itself and anything else to a Maps search', () => {
    expect(locationHref('https://example.com/studio?a=1')).toBe('https://example.com/studio?a=1');
    expect(locationHref('123 Main St, Madison')).toBe('https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Madison');
  });

  // A location synced from Google Calendar went into the admin calendar's
  // tooltip href as is, so a quote in it could add an onmouseover handler.
  it('never returns a quote or angle bracket that could break out of an href', () => {
    for (const bad of [
      'https://x" onmouseover="alert(1)',
      "https://x/' onmouseover='alert(1)",
      'https://x/"><script>alert(1)</script>',
      'https://x/path" onmouseover="alert(1)',
      'https://x/?q=" onmouseover="alert(1)',
      'https://x/#" onmouseover="alert(1)',
    ]) {
      expect(locationHref(bad), bad).not.toMatch(/["'<>\s`]/);
    }
  });

  it('never links to anything but http(s)', () => {
    expect(locationHref('javascript:alert(1)')).toMatch(/^https:\/\/www\.google\.com\/maps\//);
    expect(locationHref('https://')).toMatch(/^https:\/\/www\.google\.com\/maps\//);
  });

  it('escapes everything that ends or opens an attribute', () => {
    expect(escapeAttr(`a"b'c<d>e&f`)).toBe('a&quot;b&#39;c&lt;d&gt;e&amp;f');
  });
});

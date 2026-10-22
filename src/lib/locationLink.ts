// Pure — safe for SSR frontmatter and browser scripts alike.
//
// Where an event's location links to: the location itself when it's a web
// address, otherwise a Google Maps search for it. Locations come from the
// synced Google Calendar as well as the editor, so a web address is parsed
// and re-serialized rather than passed through: anything that isn't a valid
// http(s) URL becomes a Maps search, and the result never contains a raw
// quote or angle bracket that could break out of an href attribute.
export function locationHref(location: string): string {
  if (/^https?:\/\//i.test(location)) {
    try {
      const url = new URL(location);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !/["'<>\s`]/.test(url.href)) return url.href;
    } catch {
      // Not a valid URL: search for it instead.
    }
  }
  // encodeURIComponent leaves ' as is.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location).replace(/'/g, '%27')}`;
}

// A string made safe to put inside a double- or single-quoted HTML attribute.
export function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

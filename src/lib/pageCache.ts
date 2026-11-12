// For pages that are the same for everyone and rarely change (About, Contact,
// Privacy Policy): Netlify's edge keeps a copy for a minute, and serves it a
// while longer while it fetches a fresh one, so most visits skip the server.
// A settings change (Site Visibility, the WhatsApp link, Where we are) shows within a minute.
export const SHARED_PAGE_CACHE = 'public, durable, s-maxage=60, stale-while-revalidate=600';

export function cacheSharedPage(headers: Headers): void {
  headers.set('Netlify-CDN-Cache-Control', SHARED_PAGE_CACHE);
}

// The Contact page is shared too, except when it was opened from an "Ask about
// a spot" link (/contact?spot=<id>, askAboutSpot.ts): that copy names a class
// and carries its own text, so the edge never stores it or serves one stored
// (and the plain page's copy is kept apart by the `spot` parameter, in case the
// edge ignored the query string). Only the edge is told; the browser's own
// copy, with what the dancer typed, is left alone.
export const NO_SHARED_CACHE = 'no-store';

export function cacheContactPage(headers: Headers, askingAboutSpot: boolean): void {
  if (askingAboutSpot) headers.set('Netlify-CDN-Cache-Control', NO_SHARED_CACHE);
  else {
    cacheSharedPage(headers);
    headers.set('Netlify-Vary', 'query=spot');
  }
}

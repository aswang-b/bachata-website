// For pages that are the same for everyone and rarely change (About, Contact,
// Privacy Policy): Netlify's edge keeps a copy for a minute, and serves it a
// while longer while it fetches a fresh one, so most visits skip the server.
// A settings change (Site Visibility, the WhatsApp link) shows within a minute.
export const SHARED_PAGE_CACHE = 'public, durable, s-maxage=60, stale-while-revalidate=600';

export function cacheSharedPage(headers: Headers): void {
  headers.set('Netlify-CDN-Cache-Control', SHARED_PAGE_CACHE);
}

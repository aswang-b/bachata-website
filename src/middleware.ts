import { defineMiddleware } from 'astro:middleware';
import { loadSiteTimeZone } from './lib/siteConfig';
import { setServerTimeZone } from './lib/siteTime';

// Only loads the site time zone (siteTime.ts) before each request, so dates
// on the server are shown in it rather than in the server's own zone (UTC on
// Netlify). It doesn't check anything: every admin API route still checks
// the admin session itself.
export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) setServerTimeZone(await loadSiteTimeZone());
  return next();
});

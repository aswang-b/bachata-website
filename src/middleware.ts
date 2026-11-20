import { defineMiddleware } from 'astro:middleware';
import { loadSiteLocation, loadSiteTimeZone, loadWhatsappUrl } from './lib/siteConfig';
import { getSiteSettings } from './lib/siteSettings';
import { setServerTimeZone } from './lib/siteTime';

// Loads what every request needs before it runs: the site time zone
// (siteTime.ts), so dates on the server are shown in it rather than in the
// server's own zone (UTC on Netlify), and for pages the Site Visibility
// settings their header is built from (Astro.locals.siteSettings), fetched
// alongside it rather than after the page's own queries, with the WhatsApp
// community link the footer and confirmations show (Astro.locals.whatsappUrl) and
// where we are (Astro.locals.siteLocation). It doesn't check
// anything: every admin API route still checks the admin session itself.
// A short link (/c/<code>, a scanned door sign) needs none of it: only a
// redirect, so it loads nothing.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered || context.url.pathname.startsWith('/c/')) return next();
  const isPage = !context.url.pathname.startsWith('/api/');
  const [timeZone, settings, whatsappUrl, siteLocation] = await Promise.all([loadSiteTimeZone(), isPage ? getSiteSettings() : undefined, isPage ? loadWhatsappUrl() : undefined, isPage ? loadSiteLocation() : undefined]);
  setServerTimeZone(timeZone);
  if (settings) context.locals.siteSettings = settings;
  if (isPage) context.locals.whatsappUrl = whatsappUrl ?? null;
  if (siteLocation) context.locals.siteLocation = siteLocation;
  return next();
});

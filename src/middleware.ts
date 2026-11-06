import { defineMiddleware } from 'astro:middleware';
import { loadSiteTimeZone, loadWhatsappUrl } from './lib/siteConfig';
import { getSiteSettings } from './lib/siteSettings';
import { setServerTimeZone } from './lib/siteTime';

// Loads what every request needs before it runs: the site time zone
// (siteTime.ts), so dates on the server are shown in it rather than in the
// server's own zone (UTC on Netlify), and for pages the Site Visibility
// settings their header is built from (Astro.locals.siteSettings), fetched
// alongside it rather than after the page's own queries, with the WhatsApp
// community link the footer and confirmations show (Astro.locals.whatsappUrl). It doesn't check
// anything: every admin API route still checks the admin session itself.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();
  const isPage = !context.url.pathname.startsWith('/api/');
  const [timeZone, settings, whatsappUrl] = await Promise.all([loadSiteTimeZone(), isPage ? getSiteSettings() : undefined, isPage ? loadWhatsappUrl() : undefined]);
  setServerTimeZone(timeZone);
  if (settings) context.locals.siteSettings = settings;
  if (isPage) context.locals.whatsappUrl = whatsappUrl ?? null;
  return next();
});

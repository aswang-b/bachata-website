export const prerender = true;

const SITE_URL = 'https://dancewithb.fun';

// Hand-rolled rather than @astrojs/sitemap: every page in this app sets
// `prerender = false` (full SSR), so the official integration — which only
// picks up statically-generated pages at build time — would emit an empty
// sitemap. This lists the public, search-worthy routes by hand instead.
const PUBLIC_PATHS = ['/', '/about', '/calendar', '/contact', '/register', '/register/events', '/check-in', '/privacy-policy'];

export async function GET() {
  const urlEntries = PUBLIC_PATHS.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

import type { APIRoute } from 'astro';
import { cleanShortCode, resolveShortLink } from '../../lib/shortLinks';
import { FAKE_QR_DOWN_HEADER, fakeQrServices } from '../../lib/testMode';

export const prerender = false;

// A scanned door sign code: dancewithb.fun/c/<code> (lib/shortLinks.ts). Asks
// the QR site where the code goes and sends the phone there (302, never
// cached; the address keeps its explicit "#"). Link-preview bots and HEAD
// requests get the same redirect without counting a scan. An unknown code is
// a 404 page; when the QR site can't be reached, the address this site last
// pointed the code at, else a 503 "try again" page. Middleware loads nothing
// for /c/, so the hop stays quick.

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

// A small page in the site's colours (no header or footer: nothing else is loaded for /c/).
function page(status: 404 | 503, heading: string, text: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#170f0d">
<title>${heading} | Dance with B</title>
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #170f0d; color: #f6ece3; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 26rem; padding: 3rem 1.5rem; text-align: center; }
  img { border-radius: 1rem; }
  h1 { margin: 1.25rem 0 0.5rem; font-family: Poppins, ui-sans-serif, system-ui, sans-serif; font-size: 1.75rem; }
  p { margin: 0; color: #b9a89b; line-height: 1.5; }
  nav { margin-top: 2rem; display: flex; flex-direction: column; gap: 1rem; align-items: center; }
  .button { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 999px; background: linear-gradient(90deg, #b81640, #c2410c); color: #fff; font-weight: 600; text-decoration: none; }
  .link { color: #ff5577; font-weight: 600; }
</style>
</head>
<body>
<main>
  <img src="/icon-192.png" alt="Dance with B" width="72" height="72">
  <h1>${heading}</h1>
  <p>${text}</p>
  <nav><a class="button" href="/">Go to the homepage</a><a class="link" href="/check-in">Check in for class</a></nav>
</main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } });
}

const notActive = () => page(404, 'This code isn’t active', 'This QR code doesn’t open anything right now. Ask your instructor for a current one.');

const handle: APIRoute = async ({ params, request, url }) => {
  const code = cleanShortCode(params.code);
  if (!code) return notActive();
  const outcome = await resolveShortLink(code, {
    method: request.method,
    userAgent: request.headers.get('User-Agent'),
    host: url.host,
    fakeDown: fakeQrServices() ? request.headers.get(FAKE_QR_DOWN_HEADER) : null,
  });
  if (outcome.kind === 'redirect') return new Response(null, { status: 302, headers: { ...NO_STORE, Location: outcome.location } });
  if (outcome.kind === 'missing') return notActive();
  return page(503, 'Couldn’t open this code', 'Try again in a moment.');
};

export const GET = handle;
export const HEAD = handle;

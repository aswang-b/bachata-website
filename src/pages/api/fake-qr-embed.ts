import type { APIRoute } from 'astro';
import { fakeBatch } from '../../lib/brandedQr';
import { fakeQrServices } from '../../lib/testMode';

export const prerender = false;

// The test suite's stand-in for qr.dancewithb.fun's embedded generator
// (E2E_FAKE_QR only; 404 everywhere else, including the live site). It "makes"
// a code for each link at once and reports to the parent page the way the
// real one does: qr-ready, a qr-progress per link, qr-done.
export const GET: APIRoute = ({ url }) => {
  if (!fakeQrServices()) return new Response('Not found', { status: 404 });
  const links = (url.searchParams.get('links') ?? '').split(',').filter(Boolean);
  const parent = url.searchParams.get('parent') ?? '';
  const replace = url.searchParams.get('replace') === '1';
  const results = fakeBatch(links, replace).map((pair) => {
    const [link, id] = pair.split(':');
    return { type: 'qr-progress', link, status: replace ? 'replaced' : 'saved', id: Number(id), contrast: '0.56' };
  });
  // JSON inside a script: no "<" left that could end it.
  const js = (v: unknown) => JSON.stringify(v).replace(/</g, String.fromCharCode(92) + 'u003c');
  const script = `
    const parent = ${js(parent)};
    const results = ${js(results)};
    const post = (m) => window.parent.postMessage(m, parent);
    post({ type: 'qr-ready', links: ${js(links)} });
    post({ type: 'qr-resize', height: 120 });
    results.forEach(post);
    post({ type: 'qr-done', results });`;
  return new Response(`<!doctype html><meta charset="utf-8"><p>Making ${links.length} codes…</p><script>${script}</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN' } });
};

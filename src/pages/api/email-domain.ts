import type { APIRoute } from 'astro';
import { domainAcceptsMail } from '../../lib/emailDomain';

export const prerender = false;

// GET ?domain=gmail.com → { ok: boolean }: whether the domain can receive
// email. Used by the sign-up and contact forms to flag a likely typo before
// submitting (they still let the visitor go ahead).
export const GET: APIRoute = async ({ url }) => {
  const domain = (url.searchParams.get('domain') ?? '').slice(0, 253);
  const ok = domain ? await domainAcceptsMail(domain) : false;
  return new Response(JSON.stringify({ ok }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
};

import type { APIRoute } from 'astro';
import { getSiteBanner } from '../../lib/siteBanner';

export const prerender = false;

export const GET: APIRoute = async () => {
  const banner = await getSiteBanner();
  return new Response(JSON.stringify(banner), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

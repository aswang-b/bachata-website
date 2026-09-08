import type { APIRoute } from 'astro';
import { getSiteSettings } from '../../lib/siteSettings';

export const prerender = false;

export const GET: APIRoute = async () => {
  const settings = await getSiteSettings();
  return new Response(JSON.stringify(settings), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

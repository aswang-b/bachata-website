import type { APIRoute } from 'astro';
import { getHomepageContent } from '../../lib/homepageContent';

export const prerender = false;

export const GET: APIRoute = async () => {
  const content = await getHomepageContent();
  return new Response(JSON.stringify(content), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

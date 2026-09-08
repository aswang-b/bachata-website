import type { APIRoute } from 'astro';
import { listFaqs } from '../../lib/faqs';

export const prerender = false;

export const GET: APIRoute = async () => {
  const faqs = await listFaqs();
  return new Response(JSON.stringify({ faqs }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

import type { APIRoute } from 'astro';
import { emailSinkPath, googleDisabled, usageCountersDisabled } from '../../lib/testMode';

export const prerender = false;

// Lets the end-to-end suite confirm, before its first test, that its dev
// server really has the test switches on (so no test can email real people).
// Not found outside the dev server.
export const GET: APIRoute = () => {
  if (!import.meta.env.DEV) return new Response('Not found', { status: 404 });
  return new Response(
    JSON.stringify({ emailSink: Boolean(emailSinkPath()), googleDisabled: googleDisabled(), usageCountersDisabled: usageCountersDisabled() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const refreshToken = body?.refreshToken;

  if (!refreshToken || typeof refreshToken !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing refreshToken.' }), { status: 400 });
  }

  const { error } = await supabase
    .from('admin_google_tokens')
    .upsert({ user_id: user.id, email: user.email, refresh_token: refreshToken }, { onConflict: 'user_id' });

  if (error) {
    console.error('Failed to store admin Google token:', error);
    return new Response(JSON.stringify({ error: 'Failed to store token.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const { count, error } = await supabase
    .from('intake_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('registration_type', 'private')
    .eq('seen', false);

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load unseen count.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ count: count ?? 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

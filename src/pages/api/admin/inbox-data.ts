import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  // Contact form messages (migration 0049).
  const { data, error } = await supabase
    .from('contact_messages')
    .select('id, created_at, first_name, last_name, email, phone, instagram, whatsapp, message, seen')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load messages.' }), { status: 500 });
  }

  // Opening the inbox is what marks messages as seen.
  const unseenIds = (data ?? []).filter((m) => !m.seen).map((m) => m.id);
  if (unseenIds.length > 0) {
    await supabase.from('contact_messages').update({ seen: true }).in('id', unseenIds);
  }

  return new Response(JSON.stringify({ messages: data ?? [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

// Swaps the sort_order of the given FAQ with its neighbor in the requested
// direction — simpler than a full drag-and-drop reorder for a short list.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { id, direction } = body ?? {};

  if (!id || typeof id !== 'string' || (direction !== 'up' && direction !== 'down')) {
    return new Response(JSON.stringify({ error: 'id and direction ("up" or "down") are required.' }), { status: 400 });
  }

  const { data: faqs, error: listError } = await supabase.from('faqs').select('id, sort_order').order('sort_order', { ascending: true });
  if (listError || !faqs) {
    return new Response(JSON.stringify({ error: 'Failed to load FAQs.' }), { status: 500 });
  }

  const index = faqs.findIndex((f) => f.id === id);
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || neighborIndex < 0 || neighborIndex >= faqs.length) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const current = faqs[index];
  const neighbor = faqs[neighborIndex];

  const { error: updateError } = await supabase.from('faqs').update({ sort_order: neighbor.sort_order }).eq('id', current.id);
  const { error: neighborError } = updateError
    ? { error: updateError }
    : await supabase.from('faqs').update({ sort_order: current.sort_order }).eq('id', neighbor.id);

  if (updateError || neighborError) {
    return new Response(JSON.stringify({ error: 'Failed to reorder FAQs.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

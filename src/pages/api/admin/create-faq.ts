import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { sanitizeFaqAnswerHtml } from '../../../lib/faqs';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { question, answer } = body ?? {};

  if (!question || typeof question !== 'string') {
    return new Response(JSON.stringify({ error: 'question is required.' }), { status: 400 });
  }

  const { data: maxRow } = await supabase.from('faqs').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextSortOrder = maxRow ? maxRow.sort_order + 1 : 0;

  const { data: row, error } = await supabase
    .from('faqs')
    .insert({
      question: question.trim(),
      answer: sanitizeFaqAnswerHtml(typeof answer === 'string' ? answer : ''),
      sort_order: nextSortOrder,
    })
    .select('id, question, answer, sort_order')
    .single();

  if (error || !row) {
    return new Response(JSON.stringify({ error: 'Failed to create FAQ.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, faq: { id: row.id, question: row.question, answer: row.answer, sortOrder: row.sort_order } }), {
    status: 200,
  });
};

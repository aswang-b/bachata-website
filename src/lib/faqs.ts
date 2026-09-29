import { supabase } from './supabase';
import { sanitizeRichHtml } from './richText';

export interface Faq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  // Whether this FAQ appears in the printed/emailed registration
  // confirmation. The on-screen accordion (homepage, confirmation page)
  // always shows every FAQ regardless of this flag.
  includeInConfirmation: boolean;
}

const FAQ_ANSWER_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);

export function sanitizeFaqAnswerHtml(html: string): string {
  return sanitizeRichHtml(html, FAQ_ANSWER_TAGS);
}

export async function listFaqs(): Promise<Faq[]> {
  const { data, error } = await supabase
    .from('faqs')
    .select('id, question, answer, sort_order, include_in_confirmation')
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('Failed to load FAQs:', error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sort_order,
    includeInConfirmation: row.include_in_confirmation,
  }));
}

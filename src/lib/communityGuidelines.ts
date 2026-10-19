import { supabase } from './supabase';
import { sanitizeRichHtml } from './richText';

// The community guidelines event registrants must agree to (admin → Guidelines
// tab, migration 0044). Blank by default; while blank, the event form shows no
// guidelines section and asks for no agreement.

// Prose plus H3 headings: each heading starts one guideline, which is how the
// confirmation page and email list them (FAQ-style, see guidelineSections).
const GUIDELINES_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'H3']);

export const MAX_GUIDELINES_LENGTH = 50000;

export function sanitizeGuidelinesHtml(html: string): string {
  return sanitizeRichHtml(html, GUIDELINES_TAGS).trim();
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

export function hasGuidelines(html: string): boolean {
  return textOf(html).length > 0;
}

export async function getCommunityGuidelines(): Promise<string> {
  const { data, error } = await supabase.from('community_guidelines').select('body').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load community guidelines:', error.message);
  return data?.body ?? '';
}

export async function setCommunityGuidelines(html: string): Promise<void> {
  const body = sanitizeGuidelinesHtml(html);
  const { error } = await supabase
    .from('community_guidelines')
    .upsert({ id: true, body: hasGuidelines(body) ? body : '', updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save community guidelines: ${error.message}`);
}

export interface GuidelineSection {
  // The heading's text, or null for text before the first heading (or when
  // there are no headings at all), which is shown as a plain block.
  title: string | null;
  body: string;
}

// Splits the guidelines at each <h3> into FAQ-style items: the heading is the
// "question", everything up to the next heading its "answer".
export function guidelineSections(html: string): GuidelineSection[] {
  const sections: GuidelineSection[] = [];
  const parts = html.split(/<h3>([\s\S]*?)<\/h3>/i);
  // split() with a capture group alternates [body, heading, body, heading, body…].
  if (hasGuidelines(parts[0])) sections.push({ title: null, body: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const title = textOf(parts[i]);
    const body = (parts[i + 1] ?? '').trim();
    if (!title && !hasGuidelines(body)) continue;
    sections.push({ title: title || null, body });
  }
  return sections;
}

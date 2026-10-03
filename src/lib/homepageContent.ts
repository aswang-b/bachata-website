import { supabase } from './supabase';
import { sanitizeRichHtml } from './richText';

export interface HomepageContent {
  lessonOverview: string;
}

// Paragraphs and lists, not just inline formatting — this renders as full
// prose blocks under "Current Lesson Offerings", not a single line.
const LESSON_OVERVIEW_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);

export function sanitizeLessonOverviewHtml(html: string): string {
  return sanitizeRichHtml(html, LESSON_OVERVIEW_TAGS);
}

export async function getHomepageContent(): Promise<HomepageContent> {
  const { data, error } = await supabase.from('homepage_content').select('lesson_overview').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load homepage content:', error.message);
  if (error || !data) return { lessonOverview: '' };
  return { lessonOverview: data.lesson_overview };
}

// Admin-chosen order of the homepage offering cards: an ordered list of series
// keys. Empty means "default order". Kept separate from getHomepageContent so a
// missing card_order column (migration not run yet) can only ever affect the
// order, never the lesson overview.
export const MAX_CARD_ORDER_LENGTH = 100;

export async function getHomepageCardOrder(): Promise<string[]> {
  const { data, error } = await supabase.from('homepage_content').select('card_order').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load homepage card order:', error.message);
  const order = data?.card_order;
  return Array.isArray(order) ? order.filter((k): k is string => typeof k === 'string') : [];
}

export async function setHomepageCardOrder(order: string[]): Promise<void> {
  const { error } = await supabase
    .from('homepage_content')
    .upsert({ id: true, card_order: order, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to update homepage card order: ${error.message}`);
}

// Orders cards by the saved key list. Cards not in the list (new classes) go
// after the ordered ones in their existing (default) order, and saved keys with
// no card (classes that have passed) are ignored — so a saved order never keeps
// a past class on the page.
export function applyCardOrder<T extends { key: string }>(cards: T[], order: string[]): T[] {
  if (order.length === 0) return cards;
  const position = new Map(order.map((key, index) => [key, index]));
  return cards
    .map((card, defaultIndex) => ({ card, defaultIndex, saved: position.get(card.key) }))
    .sort((a, b) => {
      if (a.saved !== undefined && b.saved !== undefined) return a.saved - b.saved;
      if (a.saved !== undefined) return -1;
      if (b.saved !== undefined) return 1;
      return a.defaultIndex - b.defaultIndex;
    })
    .map(({ card }) => card);
}

export async function setHomepageContent(update: Partial<HomepageContent>): Promise<void> {
  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  if (update.lessonOverview !== undefined) patch.lesson_overview = sanitizeLessonOverviewHtml(update.lessonOverview);

  const { error } = await supabase.from('homepage_content').upsert(patch);
  if (error) throw new Error(`Failed to update homepage content: ${error.message}`);
}

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

export async function setHomepageContent(update: Partial<HomepageContent>): Promise<void> {
  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  if (update.lessonOverview !== undefined) patch.lesson_overview = sanitizeLessonOverviewHtml(update.lessonOverview);

  const { error } = await supabase.from('homepage_content').upsert(patch);
  if (error) throw new Error(`Failed to update homepage content: ${error.message}`);
}

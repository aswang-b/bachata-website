import { randomUUID } from 'node:crypto';
import { supabase } from './supabase';
import { allVisibilities } from './testMode';
import { findConflicts, ruleFromRow, ruleToRow, samePair, type LinkRule, type LinkRuleRow } from './linkRules';

// Linked classes/events (event_links and event_link_rules, migration 0061):
// reading and changing them for the editor's "Linked Classes/Events" section.
// See linkRules.ts for what the rules mean. Linking always covers whole series.

export interface SeriesLink {
  seriesKey: string;
  groupId: string;
}

export class LinkInputError extends Error {}

const SAFE_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSeriesKey = (v: unknown): v is string => typeof v === 'string' && SAFE_KEY_RE.test(v);

// The PostgREST filter for every occurrence of these series.
function seriesFilter(keys: string[]): string {
  const ids = keys.filter((k) => UUID_RE.test(k));
  return [`google_recurring_event_id.in.(${keys.join(',')})`, ...(ids.length ? [`id.in.(${ids.join(',')})`] : [])].join(',');
}

export async function listLinks(): Promise<{ links: SeriesLink[]; rules: LinkRule[] }> {
  const [links, rules] = await Promise.all([
    supabase.from('event_links').select('series_key, link_group_id'),
    supabase.from('event_link_rules').select('key_a, key_b, kind, reason, count_headcount'),
  ]);
  if (links.error || rules.error) throw new Error(`Failed to load linked classes: ${(links.error ?? rules.error)!.message}`);
  return {
    links: (links.data ?? []).map((l) => ({ seriesKey: l.series_key, groupId: l.link_group_id })),
    rules: ((rules.data ?? []) as LinkRuleRow[]).map(ruleFromRow),
  };
}

// The series linked with `key` (itself included), or just [key] when it isn't linked.
async function groupOf(key: string): Promise<{ groupId: string | null; keys: string[] }> {
  const { data: own, error } = await supabase.from('event_links').select('link_group_id').eq('series_key', key).maybeSingle();
  if (error) throw new Error(`Failed to load linked classes: ${error.message}`);
  if (!own) return { groupId: null, keys: [key] };
  const { data: members, error: membersError } = await supabase.from('event_links').select('series_key').eq('link_group_id', own.link_group_id);
  if (membersError) throw new Error(`Failed to load linked classes: ${membersError.message}`);
  return { groupId: own.link_group_id, keys: (members ?? []).map((m) => m.series_key) };
}

async function rulesAmong(keys: string[]): Promise<LinkRule[]> {
  const { data, error } = await supabase.from('event_link_rules').select('key_a, key_b, kind, reason, count_headcount').in('key_a', keys).in('key_b', keys);
  if (error) throw new Error(`Failed to load link rules: ${error.message}`);
  return ((data ?? []) as LinkRuleRow[]).map(ruleFromRow);
}

// Every rule among the series linked with any of `keys`, for pricing a
// sign-up. A failed read means no rules (logged): rules never block a sign-up.
export async function rulesForSeries(keys: string[]): Promise<LinkRule[]> {
  const unique = [...new Set(keys)].filter(isSeriesKey);
  if (unique.length === 0) return [];
  const { data: own, error } = await supabase.from('event_links').select('link_group_id').in('series_key', unique);
  if (error) {
    console.error('Failed to load linked classes:', error.message);
    return [];
  }
  const groupIds = [...new Set((own ?? []).map((l) => l.link_group_id))];
  if (groupIds.length === 0) return [];
  const { data: members, error: membersError } = await supabase.from('event_links').select('series_key').in('link_group_id', groupIds);
  if (membersError) {
    console.error('Failed to load linked classes:', membersError.message);
    return [];
  }
  try {
    return await rulesAmong((members ?? []).map((m) => m.series_key));
  } catch (err) {
    console.error(err);
    return [];
  }
}

// One occurrence of a series, for its type, title and flyer.
async function seriesInfo(key: string): Promise<{ title: string; eventType: string; flyerUrl: string | null } | null> {
  const { data, error } = await supabase
    .from('events')
    .select('title, event_type, flyer_url, start_time')
    .in('visibility', allVisibilities())
    .or(seriesFilter([key]))
    .order('start_time', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to load the class: ${error.message}`);
  const row = data?.[0];
  return row ? { title: row.title, eventType: row.event_type, flyerUrl: row.flyer_url } : null;
}

// Puts this flyer on every occurrence of every series linked with `key`.
export async function applyFlyerToLinked(key: string, flyerUrl: string | null): Promise<void> {
  const { keys } = await groupOf(key);
  if (keys.length < 2) return;
  const { error } = await supabase.from('events').update({ flyer_url: flyerUrl }).or(seriesFilter(keys));
  if (error) throw new Error(`Failed to share the flyer with linked classes: ${error.message}`);
}

// Links `target` (and anything already linked with it) to `source`'s linked
// set; all of them take source's flyer, or target's when source has none.
export async function linkSeries(sourceKey: string, targetKey: string): Promise<{ flyerUrl: string | null }> {
  if (sourceKey === targetKey) throw new LinkInputError("A class can't be linked to itself.");
  const [source, target] = await Promise.all([seriesInfo(sourceKey), seriesInfo(targetKey)]);
  if (!source || !target) throw new LinkInputError("That class or event couldn't be found. Reload the page and try again.");
  if (source.eventType !== target.eventType) throw new LinkInputError('Classes can only be linked to classes, and events to events.');

  const [sourceGroup, targetGroup] = await Promise.all([groupOf(sourceKey), groupOf(targetKey)]);
  const groupId = sourceGroup.groupId ?? targetGroup.groupId ?? randomUUID();
  const members = [...new Set([...sourceGroup.keys, ...targetGroup.keys])];
  const { error } = await supabase.from('event_links').upsert(members.map((k) => ({ series_key: k, link_group_id: groupId })));
  if (error) throw new Error(`Failed to link: ${error.message}`);

  const flyerUrl = source.flyerUrl ?? target.flyerUrl;
  if (flyerUrl) {
    const { error: flyerError } = await supabase.from('events').update({ flyer_url: flyerUrl }).or(seriesFilter(members));
    if (flyerError) throw new Error(`Linked, but the flyer couldn't be shared: ${flyerError.message}`);
  }
  return { flyerUrl };
}

// Takes a series out of its linked set, with its rules. A set left with one
// series isn't linked to anything, so it goes too. Also used when a series is deleted.
export async function unlinkSeries(key: string): Promise<void> {
  const { groupId, keys } = await groupOf(key);
  const rest = keys.filter((k) => k !== key);
  const { error: rulesError } = await supabase.from('event_link_rules').delete().or(`key_a.eq.${key},key_b.eq.${key}`);
  if (rulesError) throw new Error(`Failed to unlink: ${rulesError.message}`);
  if (!groupId) return;
  const gone = rest.length === 1 ? [key, ...rest] : [key];
  const { error } = await supabase.from('event_links').delete().in('series_key', gone);
  if (error) throw new Error(`Failed to unlink: ${error.message}`);
}

export type RuleChoice = 'both' | 'exclusive' | 'includes';

// Sets the rule between two linked series: 'includes' means `a` includes `b`
// (and, with countHeadcount, a's sign-ups count in b's headcount).
// Refused when the result contradicts itself (linkRules.findConflicts).
export async function setRule(a: string, b: string, choice: RuleChoice, reason: string | null, countHeadcount = true): Promise<LinkRule[]> {
  const { keys } = await groupOf(a);
  if (a === b || !keys.includes(b)) throw new LinkInputError('Those two aren\'t linked. Reload the page and try again.');
  const current = await rulesAmong(keys);
  const others = current.filter((r) => !samePair(r, a, b));
  const next: LinkRule | null = choice === 'both' ? null : { from: a, to: b, kind: choice, reason: reason?.trim() || null, countHeadcount };
  const after = next ? [...others, next] : others;

  const titles = new Map<string, string>();
  await Promise.all(keys.map(async (k) => titles.set(k, (await seriesInfo(k))?.title ?? k)));
  const conflicts = findConflicts(keys, after, (k) => titles.get(k) ?? k);
  if (conflicts.length > 0) throw new LinkInputError(conflicts[0]);

  const row = ruleToRow({ from: a, to: b, kind: 'exclusive', reason: null });
  const { error } = next
    ? await supabase.from('event_link_rules').upsert({ ...ruleToRow(next), updated_at: new Date().toISOString() })
    : await supabase.from('event_link_rules').delete().eq('key_a', row.key_a).eq('key_b', row.key_b);
  if (error) throw new Error(`Failed to save the rule: ${error.message}`);
  return after;
}

// "Make these a choose-one group": every linked pair becomes "Cannot take both".
export async function makeChooseOne(key: string): Promise<void> {
  const { keys } = await groupOf(key);
  if (keys.length < 2) throw new LinkInputError('Link at least two classes first.');
  const rows = keys.flatMap((a, i) => keys.slice(i + 1).map((b) => ({ ...ruleToRow({ from: a, to: b, kind: 'exclusive', reason: null }), updated_at: new Date().toISOString() })));
  const { error } = await supabase.from('event_link_rules').upsert(rows);
  if (error) throw new Error(`Failed to save the rules: ${error.message}`);
}

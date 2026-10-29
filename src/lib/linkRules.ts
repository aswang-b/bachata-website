// Linked classes/events (the editor's "Linked Classes/Events" section,
// migration 0061). Pure functions, shared by the editor, the server and the
// registration form, so they always agree.
//
// Classes or events sold off one flyer are linked as whole series (by series
// key, `google_recurring_event_id ?? id`). Each linked pair can have a rule:
// can take both (the default, no rule), cannot take both, or one includes the
// other. Rules never block a sign-up: a picked class another pick includes
// is folded into it (never saved or charged on its own), and taking both of a
// "cannot take both" pair only shows a warning. An includes rule can also
// count the including class's sign-ups in the included one's headcount
// (spot_counts_with_linked, migration 0062).

export type LinkRuleKind = 'exclusive' | 'includes';

export interface LinkRule {
  // For 'includes', `from` includes `to`; for 'exclusive' the order doesn't matter.
  from: string;
  to: string;
  kind: LinkRuleKind;
  // The admin's own wording for the registration form's note; null shows the default.
  reason: string | null;
  // Includes only: the including class's sign-ups count in the included one's headcount.
  countHeadcount?: boolean;
}

// How a rule is stored (event_link_rules): one row per pair, key_a < key_b.
export interface LinkRuleRow {
  key_a: string;
  key_b: string;
  kind: 'exclusive' | 'a_includes_b' | 'b_includes_a';
  reason: string | null;
  count_headcount?: boolean;
}

export const REASON_MAX_LENGTH = 200;

export function ruleFromRow(r: LinkRuleRow): LinkRule {
  const countHeadcount = r.count_headcount !== false;
  if (r.kind === 'b_includes_a') return { from: r.key_b, to: r.key_a, kind: 'includes', reason: r.reason, countHeadcount };
  return { from: r.key_a, to: r.key_b, kind: r.kind === 'exclusive' ? 'exclusive' : 'includes', reason: r.reason, countHeadcount };
}

export function ruleToRow(rule: LinkRule): LinkRuleRow {
  const [keyA, keyB] = rule.from < rule.to ? [rule.from, rule.to] : [rule.to, rule.from];
  const kind = rule.kind === 'exclusive' ? 'exclusive' : rule.from === keyA ? 'a_includes_b' : 'b_includes_a';
  return { key_a: keyA, key_b: keyB, kind, reason: rule.reason, count_headcount: rule.countHeadcount !== false };
}

export const samePair = (rule: LinkRule, a: string, b: string) => (rule.from === a && rule.to === b) || (rule.from === b && rule.to === a);

export function ruleFor(rules: LinkRule[], a: string, b: string): LinkRule | null {
  return rules.find((r) => samePair(r, a, b)) ?? null;
}

// Everything picking `key` comes with: what it includes, and what those include.
export function includedBy(key: string, rules: LinkRule[]): Set<string> {
  const found = new Set<string>();
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const r of rules) {
      if (r.kind === 'includes' && r.from === current && r.to !== key && !found.has(r.to)) {
        found.add(r.to);
        queue.push(r.to);
      }
    }
  }
  return found;
}

// The default wording of a rule's note on the registration form, shown as the
// reason box's placeholder in the editor.
export function defaultReason(rule: LinkRule, titleOf: (key: string) => string): string {
  return rule.kind === 'includes'
    ? `${titleOf(rule.to)} is included with ${titleOf(rule.from)}, so you won't be charged for it twice.`
    : `${titleOf(rule.from)} and ${titleOf(rule.to)} are usually taken one or the other.`;
}

export const reasonText = (rule: LinkRule, titleOf: (key: string) => string) => rule.reason?.trim() || defaultReason(rule, titleOf);

// Rule sets that contradict themselves, which the editor won't save: an
// include loop, or a class that comes with two things that can't be taken
// together (so taking it would always set off a warning).
export function findConflicts(keys: string[], rules: LinkRule[], titleOf: (key: string) => string): string[] {
  const conflicts: string[] = [];
  for (const key of keys) {
    const comesWith = includedBy(key, rules);
    if (rules.some((r) => r.kind === 'includes' && r.to === key && comesWith.has(r.from))) {
      conflicts.push(`${titleOf(key)} ends up including itself. Remove one of the "includes" rules in that loop.`);
      continue;
    }
    const taken = [key, ...comesWith];
    for (const r of rules) {
      if (r.kind === 'exclusive' && taken.includes(r.from) && taken.includes(r.to)) {
        const [a, b] = [r.from, r.to].map(titleOf);
        conflicts.push(`${titleOf(key)} comes with both ${a} and ${b}, which are set as "Cannot take both".`);
      }
    }
  }
  return [...new Set(conflicts)];
}

export interface LinkedPicks {
  // Picked by the dancer, after dropping anything another pick already includes.
  picked: string[];
  // Comes free with a pick: included key → the picked key that includes it.
  included: Map<string, string>;
  // Picked separately but already included by another pick (the form explains it was folded in).
  folded: { key: string; by: string }[];
  // "Cannot take both" pairs among everything they'll have.
  warnings: LinkRule[];
}

// What one dancer ends up with for the series they picked.
export function resolvePicks(pickedKeys: string[], rules: LinkRule[]): LinkedPicks {
  const unique = [...new Set(pickedKeys)];
  const included = new Map<string, string>();
  // In pick order, so of two picks that include each other (a loop the editor
  // refuses) the first one stays picked.
  for (const key of unique) {
    if (included.has(key)) continue;
    for (const inner of includedBy(key, rules)) {
      if (!included.has(inner)) included.set(inner, key);
    }
  }
  // Credit each included class to the pick it really came with (Practica
  // picked before Workshop, which includes it, came with Workshop).
  for (const [k, by] of included) {
    let owner = by;
    for (let hops = 0; included.has(owner) && hops < unique.length; hops++) owner = included.get(owner)!;
    included.set(k, owner);
  }
  const picked = unique.filter((k) => !included.has(k));
  const folded = unique.filter((k) => included.has(k)).map((k) => ({ key: k, by: included.get(k)! }));
  const all = [...picked, ...included.keys()];
  const warnings = rules.filter((r) => r.kind === 'exclusive' && all.includes(r.from) && all.includes(r.to));
  return { picked, included, folded, warnings };
}

export interface Combination {
  // What the dancer picks, and what comes with it.
  picked: string[];
  included: string[];
  warned: boolean;
}

// Every distinct thing a dancer can sign up for among the linked series, for
// the editor's "What dancers can sign up for" summary. Null past six series
// (too many to list).
export function combinations(keys: string[], rules: LinkRule[]): Combination[] | null {
  if (keys.length > 6) return null;
  const seen = new Set<string>();
  const result: Combination[] = [];
  for (let mask = 1; mask < 1 << keys.length; mask++) {
    const subset = keys.filter((_, i) => mask & (1 << i));
    const { picked, included, warnings } = resolvePicks(subset, rules);
    const id = [...picked].sort().join('|');
    if (seen.has(id) || picked.length !== subset.length) continue;
    seen.add(id);
    result.push({ picked, included: [...included.keys()], warned: warnings.length > 0 });
  }
  return result.sort((a, b) => Number(a.warned) - Number(b.warned) || a.picked.length - b.picked.length);
}

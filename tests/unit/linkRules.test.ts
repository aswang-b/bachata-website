import { describe, expect, it } from 'vitest';
import {
  combinations,
  defaultReason,
  findConflicts,
  includedBy,
  reasonText,
  resolvePicks,
  ruleFromRow,
  ruleToRow,
  type LinkRule,
} from '../../src/lib/linkRules';

const titles: Record<string, string> = { ws: 'Workshop', pr: 'Practica', l2: 'Level 2', x: 'Extra' };
const titleOf = (k: string) => titles[k] ?? k;
const includes = (from: string, to: string, reason: string | null = null): LinkRule => ({ from, to, kind: 'includes', reason });
const exclusive = (from: string, to: string, reason: string | null = null): LinkRule => ({ from, to, kind: 'exclusive', reason });

describe('storing rules', () => {
  it('round-trips through the one-row-per-pair form in either direction', () => {
    for (const rule of [includes('ws', 'pr'), includes('pr', 'ws'), exclusive('ws', 'l2', 'Same time')]) {
      const row = ruleToRow(rule);
      expect(row.key_a < row.key_b).toBe(true);
      const back = ruleFromRow(row);
      if (rule.kind === 'includes') expect(back).toEqual(rule);
      else expect([back.from, back.to].sort()).toEqual([rule.from, rule.to].sort());
    }
  });
});

describe('includes', () => {
  it('follows includes through other includes', () => {
    expect([...includedBy('ws', [includes('ws', 'pr'), includes('pr', 'x')])].sort()).toEqual(['pr', 'x']);
    expect(includedBy('pr', [includes('ws', 'pr')]).size).toBe(0);
  });
});

describe('resolving a dancer\'s picks', () => {
  const rules = [includes('ws', 'pr'), exclusive('ws', 'l2')];

  it('folds a separately picked included class into the one that includes it, in either order', () => {
    for (const picks of [['ws', 'pr'], ['pr', 'ws']]) {
      const r = resolvePicks(picks, rules);
      expect(r.picked).toEqual(['ws']);
      expect([...r.included]).toEqual([['pr', 'ws']]);
      expect(r.folded).toEqual([{ key: 'pr', by: 'ws' }]);
      expect(r.warnings).toEqual([]);
    }
  });

  it('adds the included class when only the bigger one is picked', () => {
    const r = resolvePicks(['ws'], rules);
    expect([...r.included.keys()]).toEqual(['pr']);
    expect(r.folded).toEqual([]);
  });

  it('warns about a "cannot take both" pair but keeps both', () => {
    const r = resolvePicks(['ws', 'l2'], rules);
    expect(r.picked).toEqual(['ws', 'l2']);
    expect(r.warnings).toEqual([exclusive('ws', 'l2')]);
  });

  it('warns when an included class clashes with another pick', () => {
    const r = resolvePicks(['ws', 'x'], [includes('ws', 'pr'), exclusive('pr', 'x')]);
    expect(r.warnings).toHaveLength(1);
  });

  it('credits a class included through another to the actual pick', () => {
    const r = resolvePicks(['pr', 'ws'], [includes('ws', 'pr'), includes('pr', 'x')]);
    expect(r.picked).toEqual(['ws']);
    expect(r.included.get('x')).toBe('ws');
    expect(r.included.get('pr')).toBe('ws');
  });

  it('keeps unrelated picks as they are', () => {
    expect(resolvePicks(['pr', 'l2'], rules)).toEqual({ picked: ['pr', 'l2'], included: new Map(), folded: [], warnings: [] });
  });
});

describe('conflicts', () => {
  it('catches a class that comes with two things that cannot be taken together', () => {
    const c = findConflicts(['ws', 'pr', 'l2'], [includes('ws', 'pr'), includes('ws', 'l2'), exclusive('pr', 'l2')], titleOf);
    expect(c).toEqual(['Workshop comes with both Practica and Level 2, which are set as "Cannot take both".']);
  });

  it('catches an include loop', () => {
    const c = findConflicts(['ws', 'pr'], [includes('ws', 'pr'), includes('pr', 'ws')], titleOf);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]).toContain('including itself');
  });

  it('accepts a normal set', () => {
    expect(findConflicts(['ws', 'pr', 'l2'], [includes('ws', 'pr'), includes('l2', 'pr'), exclusive('ws', 'l2')], titleOf)).toEqual([]);
  });
});

describe('the editor summary', () => {
  it('lists each distinct sign-up once, warned ones last', () => {
    const list = combinations(['ws', 'pr', 'l2'], [includes('ws', 'pr'), includes('l2', 'pr'), exclusive('ws', 'l2')])!;
    expect(list.map((c) => [c.picked.join('+'), c.included.join('+'), c.warned])).toEqual([
      ['ws', 'pr', false],
      ['pr', '', false],
      ['l2', 'pr', false],
      ['ws+l2', 'pr', true],
    ]);
  });

  it('gives up past six series', () => {
    expect(combinations(['a', 'b', 'c', 'd', 'e', 'f', 'g'], [])).toBeNull();
  });
});

describe('note wording', () => {
  it('uses the admin\'s reason, or the default', () => {
    expect(defaultReason(includes('ws', 'pr'), titleOf)).toBe("Practica is included with Workshop, so you won't be charged for it twice.");
    expect(reasonText(exclusive('ws', 'l2', '  '), titleOf)).toBe('Workshop and Level 2 are usually taken one or the other.');
    expect(reasonText(exclusive('ws', 'l2', 'They run at the same time.'), titleOf)).toBe('They run at the same time.');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The admin dashboard's filter modules are shared with its browser script. They
// once imported dateRange from flyerBlocks.ts, so the dashboard's module graph
// (what the dev server loads, and what a bundler has to prove unused) took in
// the homepage's pricing and deal code. Everything they reach must stay light.
const ROOT = join(__dirname, '../..');
const ENTRIES = ['src/lib/eventRegistrationFilter.ts', 'src/lib/classFilterGroup.ts', 'src/lib/classFilterOptions.ts'];
const HOMEPAGE_ONLY = ['flyerBlocks', 'pricing', 'deals', 'countdown', 'dealRules'];

// Every module reachable through value imports (type-only imports leave no code).
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry) || !existsSync(join(ROOT, entry))) return seen;
  seen.add(entry);
  const source = readFileSync(join(ROOT, entry), 'utf8');
  for (const m of source.matchAll(/^(?:import|export)\s(?!type\s)[^;]*?from\s+'(\.[^']+)'/gm)) {
    reachable(join(dirname(entry), `${m[1]}.ts`).replace(/\\/g, '/'), seen);
  }
  return seen;
}

describe('the dashboard filter modules', () => {
  it('reach none of the homepage pricing or deal code', () => {
    for (const entry of ENTRIES.filter((e) => existsSync(join(ROOT, e)))) {
      const modules = [...reachable(entry)].map((f) => f.replace(/^.*\//, '').replace(/\.ts$/, ''));
      expect(modules.filter((m) => HOMEPAGE_ONLY.includes(m)), `${entry} reaches ${modules.join(', ')}`).toEqual([]);
    }
  });

  it('dateRange lives in the light schedule module', () => {
    expect(readFileSync(join(ROOT, 'src/lib/classSchedule.ts'), 'utf8')).toContain('export function dateRange');
    expect(readFileSync(join(ROOT, 'src/lib/flyerBlocks.ts'), 'utf8')).not.toContain('export function dateRange');
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Rules the code has to keep that are easy to break without noticing: each
// one is here because breaking it caused a real problem before.

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function filesUnder(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) out.push(...filesUnder(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe('codebase rules', () => {
  it('every admin API route checks the admin session itself (there is no middleware in front of them)', () => {
    const unguarded = filesUnder('src/pages/api/admin', ['.ts']).filter((f) => !/requireAdmin\(/.test(read(f)));
    expect(unguarded).toEqual([]);
  });

  it("signs out with scope 'local' everywhere: a default (global) sign-out logs the admin out on every device", () => {
    const offenders = filesUnder('src', ['.ts', '.astro'])
      .flatMap((f) => read(f).split('\n').map((line, i) => ({ f: relative(root, join(root, f)), i: i + 1, line })))
      .filter(({ line }) => /\.signOut\(/.test(line) && !/scope:\s*'local'/.test(line) && !/admin\.signOut\([^)]*'local'/.test(line));
    expect(offenders).toEqual([]);
  });

  it('the calendar sync never upserts events (the google_event_id index is partial, so ON CONFLICT fails)', () => {
    expect(read('src/lib/calendarSync.ts')).not.toMatch(/from\('events'\)\s*\.upsert/);
  });

  it('the public sign-up and check-in forms never lock their submit button (the server catches duplicates instead)', () => {
    for (const f of ['src/components/RegistrationForm.astro', 'src/components/IntakeForm.astro']) {
      expect(read(f), f).not.toMatch(/(submit|Submit)\w*\.disabled\s*=\s*true/);
    }
  });

  it('migrations are numbered uniquely and without gaps', () => {
    const numbers = readdirSync(join(root, 'supabase/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .map((n) => Number(n.slice(0, 4)))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('test-mode switches are only honored by the dev server', () => {
    expect(read('src/lib/testMode.ts')).toMatch(/env\?\.DEV/);
  });
});

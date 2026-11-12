import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import astroConfig from '../../astro.config.mjs';

// The e2e suite writes its traces, screenshots and email sink inside the
// project while its own dev server runs. Watched, each write was a file change
// for that server (~26,000 in a full run): requests waited up to 20 s before
// reaching the site's code, and after any failed request Astro reloaded every
// open page. So the dev server must not watch any of it.
const root = path.resolve(__dirname, '../..');
const playwrightConfig = readFileSync(path.join(root, 'playwright.config.ts'), 'utf8');
const quoted = (key: string) => playwrightConfig.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];

// Matched the way Vite's file watcher matches `ignored` (picomatch, dot folders included).
const picomatch = createRequire(import.meta.url)('picomatch') as (glob: string, options: { dot: boolean }) => (file: string) => boolean;

function ignoredByDevServer(file: string): boolean {
  const ignored = astroConfig.vite?.server?.watch?.ignored;
  const patterns = (Array.isArray(ignored) ? ignored : [ignored]).filter((p): p is string => typeof p === 'string');
  const abs = path.join(root, file).replace(/\\/g, '/');
  return patterns.some((p) => picomatch(p, { dot: true })(abs));
}

describe('the dev server does not watch the e2e output', () => {
  it('finds where Playwright writes', () => {
    expect(quoted('outputDir')).toBeTruthy();
    expect(quoted('outputFolder')).toBeTruthy();
  });

  it('ignores traces, the report and the email sink', () => {
    expect(ignoredByDevServer(`${quoted('outputDir')}/.playwright-artifacts-0/traces/resources/abc.html`)).toBe(true);
    expect(ignoredByDevServer(`${quoted('outputDir')}/some-test/trace.zip`)).toBe(true);
    expect(ignoredByDevServer(`${quoted('outputFolder')}/index.html`)).toBe(true);
    expect(ignoredByDevServer('tests/e2e/.output/emails.jsonl')).toBe(true);
  });

  it('still watches the site and the tests themselves', () => {
    expect(ignoredByDevServer('src/pages/index.astro')).toBe(false);
    expect(ignoredByDevServer('tests/e2e/qr.spec.ts')).toBe(false);
  });
});

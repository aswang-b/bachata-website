import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// The project's .env, read directly (the test runner, unlike Astro, doesn't load it).
function loadDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(ROOT, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
    );
  } catch {
    return {};
  }
}

const fileEnv = loadDotEnv();
export const env = (key: string): string => {
  const v = process.env[key] ?? fileEnv[key];
  if (!v) throw new Error(`Missing ${key} (set it in .env)`);
  return v;
};

export const PORT = 4322;
export const BASE_URL = `http://localhost:${PORT}`;
export const EMAIL_SINK = join(ROOT, 'tests', 'e2e', '.output', 'emails.jsonl');
// The test server's Resend webhook signing secret (a made-up one), so tests can sign bounce events.
export const WEBHOOK_SECRET = `whsec_${Buffer.from('e2e-only-webhook-secret').toString('base64')}`;

// Every row the suite creates starts with this, so a sweep can always find
// (and delete) leftovers — including ones from a run that crashed midway.
export const TEST_PREFIX = 'ZZZ';
export const RUN_ID = process.env.E2E_RUN_ID ?? Date.now().toString(36).slice(-5).toUpperCase();
process.env.E2E_RUN_ID = RUN_ID;

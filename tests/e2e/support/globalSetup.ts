import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { sweepTestData } from './db';
import { EMAIL_SINK } from './env';

// Starts every run from a clean slate: no leftover ZZZ rows from a crashed run
// (they'd be flagged as duplicates of this run's sign-ups) and an empty email sink.
export default async function globalSetup() {
  mkdirSync(dirname(EMAIL_SINK), { recursive: true });
  rmSync(EMAIL_SINK, { force: true });
  await sweepTestData();
}

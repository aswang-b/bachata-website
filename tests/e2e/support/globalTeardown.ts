import { sweepTestData } from './db';

export default async function globalTeardown() {
  await sweepTestData();
}

import { defineConfig } from 'vitest/config';

// Unit tests (tests/unit): pure logic plus the server modules, with Supabase,
// Google and fetch replaced by fakes. Nothing here touches the network or the
// real database. The end-to-end suite (tests/e2e) runs under Playwright instead.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
  },
});

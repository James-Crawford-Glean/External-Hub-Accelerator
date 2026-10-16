import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Most tests are pure-logic in the node env (searchFeed abstraction, fuzzy ranker, feed
// factories, selection selectors). A few *.test.tsx render real pickers under jsdom via an
// `// @vitest-environment jsdom` docblock — kept to *.test.tsx so Playwright's e2e/*.spec.ts is
// never picked up here. The react plugin gives those the automatic JSX runtime.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

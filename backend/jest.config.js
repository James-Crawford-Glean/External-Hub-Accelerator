/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Cap worker parallelism: the integration specs each boot an embedded Postgres
  // (pglite = WASM + all migrations per instance), so running one-per-core spikes
  // memory and flakes on small CI runners. '50%' halves peak concurrent instances
  // (→ 2 workers on a 4-core runner) while keeping the fast unit specs parallel.
  // The suite is deterministic under this cap; --runInBand also passes.
  maxWorkers: '50%',
  // Integration specs boot pglite and replay every migration in beforeAll; keep the
  // hook budget well clear of that cost so a slow boot never reads as a broken test.
  testTimeout: 30_000,
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Transpile-only: source type-safety is enforced by `tsc` (npm run typecheck);
  // don't let strict typing of test doubles block the suite.
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
    '^.+\\.(html|mjml)$': '<rootDir>/jest.text-transform.js',
  },
  roots: ['<rootDir>/apps', '<rootDir>/libs'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@libs/access-requests$': '<rootDir>/libs/access-requests/src',
    '^@libs/aurora$': '<rootDir>/libs/aurora/src',
    '^@libs/authz$': '<rootDir>/libs/authz/src',
    '^@libs/avatar$': '<rootDir>/libs/avatar/src',
    '^@libs/cache$': '<rootDir>/libs/cache/src',
    '^@libs/credentials$': '<rootDir>/libs/credentials/src',
    '^@libs/di$': '<rootDir>/libs/di/src',
    '^@libs/glean$': '<rootDir>/libs/glean/src',
    '^@libs/glean-index$': '<rootDir>/libs/glean-index/src',
    '^@libs/identity$': '<rootDir>/libs/identity/src',
    '^@libs/items$': '<rootDir>/libs/items/src',
    '^@libs/log$': '<rootDir>/libs/log/src',
    '^@libs/login-events$': '<rootDir>/libs/login-events/src',
    '^@libs/logo$': '<rootDir>/libs/logo/src',
    '^@libs/metrics$': '<rootDir>/libs/metrics/src',
    '^@libs/roster$': '<rootDir>/libs/roster/src',
    '^@libs/sql$': '<rootDir>/libs/sql/src',
    '^@libs/sync-runs$': '<rootDir>/libs/sync-runs/src',
    '^@libs/testkit$': '<rootDir>/libs/testkit/src',
    '^@libs/urls$': '<rootDir>/libs/urls/src',
    '^@libs/worker$': '<rootDir>/libs/worker/src',
  },
  collectCoverageFrom: ['{apps,libs}/**/*.ts', '!**/*.spec.ts', '!**/lambda.ts', '!**/main.ts'],
};

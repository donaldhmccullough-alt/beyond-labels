/**
 * jest.config.js
 *
 * Uses next/jest so the SWC compiler that Next.js already depends on
 * handles transformation. This lets Jest parse ESM import/export syntax
 * in pages/api/*.js without a separate Babel setup.
 *
 * Key points:
 *  - testEnvironment: 'node'  — API routes are server-side; no DOM needed
 *  - next/jest default env is jsdom, so we override it here
 *  - rulesEngine.js stays CommonJS; SWC interop handles the import correctly
 */
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Path to the Next.js app root (where next.config.js lives)
  dir: './',
});

module.exports = createJestConfig({
  testEnvironment: 'node',
  testMatch: [
    '**/lib/**/*.test.js',
    '**/__tests__/**/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/.next/'],
});

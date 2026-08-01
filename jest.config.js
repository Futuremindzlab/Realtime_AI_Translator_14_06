/**
 * Jest configuration for the Expo app's unit tests.
 *
 * Two projects instead of the multi-platform `jest-expo` preset, so each suite
 * runs exactly once under a known platform: several modules ship platform
 * variants (translationProvider.native.ts, whisperService.web.ts) or branch on
 * Platform.OS, and running every suite on every platform would make it
 * ambiguous which implementation is under test. Suites named `*.web.test.ts`
 * run on web; everything else runs on iOS.
 */
const moduleNameMapper = { '^@/(.*)$': '<rootDir>/$1' };

module.exports = {
  projects: [
    {
      displayName: 'ios',
      preset: 'jest-expo/ios',
      moduleNameMapper,
      testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
      testPathIgnorePatterns: ['/node_modules/', '\\.web\\.test\\.tsx?$'],
    },
    {
      displayName: 'web',
      preset: 'jest-expo/web',
      moduleNameMapper,
      testMatch: ['<rootDir>/__tests__/**/*.web.test.ts?(x)'],
    },
  ],
  // babel-plugin-istanbul's test-exclude is incompatible with the repo-wide
  // minimatch@9 override, so collect coverage from V8 instead.
  coverageProvider: 'v8',
  collectCoverageFrom: ['lib/**/*.ts', 'services/**/*.ts', 'hooks/**/*.ts', '!**/*.d.ts'],
  coverageReporters: ['text', 'lcov'],
};

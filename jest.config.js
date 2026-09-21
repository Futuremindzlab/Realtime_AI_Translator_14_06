// Jest config for the app's own pure-logic tests (lib/, contexts/, services/).
// jest-expo's preset handles the RN/Expo module transforms; tests here are
// intentionally scoped to plain TS/JS logic that doesn't require rendering a
// component — see __tests__/README.md for why, and what a follow-up pass
// would need to add component-level coverage.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Metro resolves the app's "@/*" tsconfig path alias automatically; Jest
  // has its own resolver and needs this told to it explicitly, or every
  // `@/lib/...` import in a test file fails to resolve.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};

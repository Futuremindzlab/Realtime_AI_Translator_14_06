import 'react-native-get-random-values';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/contexts/AuthContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthGate } from '@/components/AuthGate';
import { initSentry } from '@/lib/sentry';

// Module-level, not inside the component — runs once at the earliest point
// in app startup, before anything else has a chance to throw. No-ops if
// EXPO_PUBLIC_SENTRY_DSN isn't set (see lib/sentry.ts).
initSentry();

export default function RootLayout() {
  useFrameworkReady();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="+not-found" />
            </Stack>
          </AuthGate>
          <StatusBar barStyle="default" />
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

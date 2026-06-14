import 'react-native-get-random-values';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider } from '@/contexts/AuthContext';
import { whisperService } from '@/services/whisperService';
import { translationProvider } from '@/services/translationProvider';

export default function RootLayout() {
  useFrameworkReady();

  // Kick off whisper model download + init in the background as soon as the
  // app launches. By the time the user records their first utterance the
  // model will usually be ready, eliminating the cold-start latency.
  useEffect(() => {
    whisperService.initialize().catch((err) => {
      console.warn('[Layout] Whisper background init failed:', err);
    });

    // Attempt to preload a sample device translation model in background.
    // Replace the model ID with the language pair(s) you need.
    translationProvider.initializeDeviceModel('Helsinki-NLP/opus-mt-en-es').then((ok) => {
      if (ok) console.log('[Layout] Device translation model preloaded');
    }).catch((err) => {
      console.warn('[Layout] Device translation preload failed:', err);
    });
  }, []);

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar barStyle="default" />
    </AuthProvider>
  );
}

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import {
  Plane, Briefcase, GraduationCap, Users, MoreHorizontal,
  ChevronLeft, ShieldCheck, Mic, Database, Ban,
} from 'lucide-react-native';
import { UserSettings } from '@/types';
import { canvasTheme as t } from '@/lib/canvasTheme';
import { PaywallView } from '@/components/onboarding/PaywallView';

const USE_CASES: { id: string; label: string; icon: typeof Plane }[] = [
  { id: 'travel',   label: 'Travel',                icon: Plane },
  { id: 'business', label: 'Business & work',        icon: Briefcase },
  { id: 'learning', label: 'Learning a language',    icon: GraduationCap },
  { id: 'family',   label: 'Family & friends',       icon: Users },
  { id: 'other',    label: 'Something else',         icon: MoreHorizontal },
];

interface Props {
  /** Persists the onboarding choice server-side (PATCH /v1/settings under
   *  the hood — see contexts/AuthContext.tsx's updateSettings). Setting
   *  onboarding_completed:true is what makes AuthGate render the app instead
   *  of this flow on the next render. */
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  /** Re-fetches settings after a Razorpay subscribe succeeds mid-onboarding,
   *  so `plan` reflects the new subscription immediately. */
  refreshSettings: () => Promise<void>;
}

const STEPS = ['use-case', 'privacy', 'paywall'] as const;
type Step = typeof STEPS[number];

/**
 * First-run flow shown between successful sign-in and the main app —
 * rendered inline by AuthGate (same "one component owns every step" pattern
 * AuthGate itself already uses for its multi-stage sign-in forms) rather than
 * as separate routed screens, so there's no risk of a user navigating away
 * from it or a redirect race with expo-router.
 *
 * Three steps: what you'll use OneLingo for (personalization only, never
 * gates anything) → a plain-language privacy summary you must acknowledge →
 * the 7-day free trial / subscribe choice. Finishing either the trial path
 * or a real subscription marks onboarding_completed and hands control back
 * to AuthGate's `children`.
 */
export function OnboardingFlow({ updateSettings, refreshSettings }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [useCase, setUseCase] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const step: Step = STEPS[stepIndex];

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const finishOnboarding = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await updateSettings({ onboarding_completed: true, use_case: useCase });
    } catch {
      Alert.alert('Something went wrong', 'Could not save your preferences — please check your connection and try again.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {stepIndex > 0 ? (
          <TouchableOpacity style={styles.backButton} onPress={goBack} hitSlop={10}>
            <ChevronLeft size={22} color={t.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backButton} />
        )}
        <View style={styles.dots}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {step === 'use-case' && (
          <>
            <Text style={styles.title}>What will you use{'\n'}OneLingo for?</Text>
            <Text style={styles.subtitle}>Helps us tailor a few defaults — nothing here restricts what you can do.</Text>
            {USE_CASES.map(({ id, label, icon: Icon }) => (
              <TouchableOpacity
                key={id}
                style={[styles.optionRow, useCase === id && styles.optionRowSelected]}
                onPress={() => { setUseCase(id); goNext(); }}
              >
                <View style={styles.optionIcon}>
                  <Icon size={18} color={t.personB} />
                </View>
                <Text style={styles.optionLabel}>{label}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 'privacy' && (
          <>
            <Text style={styles.title}>Your data, your control</Text>
            <Text style={styles.subtitle}>The short version — grounded in exactly what the app does, not boilerplate.</Text>

            <View style={styles.consentRow}>
              <Mic size={18} color={t.personB} />
              <Text style={styles.consentText}>
                Audio you record is sent to our server to transcribe and translate it, then discarded — it is
                not stored as audio.
              </Text>
            </View>
            <View style={styles.consentRow}>
              <Database size={18} color={t.personB} />
              <Text style={styles.consentText}>
                Translation text is saved to your History so you can revisit it, and you can delete any item —
                or everything — at any time from the History tab.
              </Text>
            </View>
            <View style={styles.consentRow}>
              <Ban size={18} color={t.personB} />
              <Text style={styles.consentText}>
                We never sell your data. It&apos;s used to provide the translation service you&apos;re asking for, and
                nothing else.
              </Text>
            </View>
            <View style={styles.consentRow}>
              <ShieldCheck size={18} color={t.personB} />
              <Text style={styles.consentText}>
                You can permanently delete your account and all associated data any time from Settings.
              </Text>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={goNext}>
              <Text style={styles.primaryButtonText}>Agree & Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'paywall' && (
          finishing ? (
            <View style={styles.finishing}>
              <ActivityIndicator size="large" color={t.personB} />
            </View>
          ) : (
            <PaywallView
              title="Try OneLingo free for 7 days"
              subtitle="10 single translations and 5 conversations, no card required. Subscribe any time for unlimited days."
              onSubscribed={async () => { await refreshSettings(); await finishOnboarding(); }}
              onContinueWithTrial={finishOnboarding}
            />
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 8,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.cardBorder,
  },
  dotActive: {
    backgroundColor: t.personB,
    width: 18,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: t.text,
    marginBottom: 10,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    color: t.textMuted,
    lineHeight: 20,
    marginBottom: 28,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  optionRowSelected: {
    borderColor: t.personBBorder,
    backgroundColor: t.personBBg,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: t.personBBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: t.text,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  consentText: {
    flex: 1,
    fontSize: 13.5,
    color: t.textMuted,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: t.personB,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: t.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  finishing: {
    paddingTop: 60,
    alignItems: 'center',
  },
});

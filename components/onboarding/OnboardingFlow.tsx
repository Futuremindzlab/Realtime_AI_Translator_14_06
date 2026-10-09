import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking, TextInput } from 'react-native';
import {
  Plane, Briefcase, GraduationCap, Users, MoreHorizontal,
  ChevronLeft, ShieldCheck, Mic, Database, Ban, User as UserIcon, Globe2,
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

const STEPS = ['use-case', 'privacy', 'profile', 'paywall'] as const;
type Step = typeof STEPS[number];

/**
 * First-run flow shown between successful sign-in and the main app —
 * rendered inline by AuthGate (same "one component owns every step" pattern
 * AuthGate itself already uses for its multi-stage sign-in forms) rather than
 * as separate routed screens, so there's no risk of a user navigating away
 * from it or a redirect race with expo-router.
 *
 * Four steps: what you'll use OneLingo for (personalization only, never
 * gates anything) → a plain-language privacy summary you must acknowledge →
 * basic account details (name + country — billing/support basics, deliberately
 * NOT including sex, address, or education; see the PR that added this step
 * for the reasoning) → the 7-day free trial / subscribe choice. Finishing
 * either the trial path or a real subscription marks onboarding_completed
 * and hands control back to AuthGate's `children`.
 */
export function OnboardingFlow({ updateSettings, refreshSettings }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [useCase, setUseCase] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('');
  const [finishing, setFinishing] = useState(false);
  const step: Step = STEPS[stepIndex];

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const finishOnboarding = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await updateSettings({
        onboarding_completed: true,
        use_case: useCase,
        full_name: fullName.trim(),
        country: country.trim(),
      });
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
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
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

            <TouchableOpacity
              onPress={() => Linking.openURL('https://theonelingo.com/legal/policies.html#privacy')}
              accessibilityRole="button"
              accessibilityLabel="Read the full privacy policy">
              <Text style={styles.privacyLink}>Read the full privacy policy →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryButton} onPress={goNext}>
              <Text style={styles.primaryButtonText}>Agree & Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'profile' && (
          <>
            <Text style={styles.title}>A few basics</Text>
            <Text style={styles.subtitle}>For your account and billing — nothing more. We never ask for sensitive details like your gender, address, or education.</Text>

            <View style={styles.inputGroup}>
              <View style={styles.inputLabelRow}>
                <UserIcon size={16} color={t.personB} />
                <Text style={styles.inputLabel}>Full name</Text>
              </View>
              <TextInput
                style={styles.textInput}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your name"
                placeholderTextColor={t.textFaint}
                autoCapitalize="words"
                autoComplete="name"
                maxLength={120}
              />
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputLabelRow}>
                <Globe2 size={16} color={t.personB} />
                <Text style={styles.inputLabel}>Country</Text>
              </View>
              <TextInput
                style={styles.textInput}
                value={country}
                onChangeText={setCountry}
                placeholder="Your country"
                placeholderTextColor={t.textFaint}
                autoCapitalize="words"
                maxLength={80}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, (!fullName.trim() || !country.trim()) && styles.primaryButtonDisabled]}
              disabled={!fullName.trim() || !country.trim()}
              onPress={goNext}>
              <Text style={styles.primaryButtonText}>Continue</Text>
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
  privacyLink: {
    fontSize: 13.5,
    color: t.personB,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  primaryButton: {
    backgroundColor: t.personB,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: t.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: t.text,
  },
  textInput: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: t.text,
  },
  finishing: {
    paddingTop: 60,
    alignItems: 'center',
  },
});

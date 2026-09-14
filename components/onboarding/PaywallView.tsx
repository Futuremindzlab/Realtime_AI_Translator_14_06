import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Check, Sparkles } from 'lucide-react-native';
import { subscribeToPlan, CheckoutCancelledError } from '@/services/billingService';
import { PLAN_INFO, PAID_PLAN_PRICE } from '@/lib/plans';
import { canvasTheme as t } from '@/lib/canvasTheme';
import { logger } from '@/lib/logger';

const PLAN_PERKS: Record<'plus' | 'live', string[]> = {
  plus: ['Streaming translation — starts speaking before it finishes generating', 'Unlimited days (daily fair-use cap applies)', 'Priority support'],
  live: ['Everything in Plus', 'Continuous live interpretation, no record/stop steps', 'Highest daily usage cap'],
};

interface Props {
  /** Called after a successful subscribe (so the caller can refresh settings
   *  and dismiss this view) — NOT called for "continue with the free trial". */
  onSubscribed: () => void | Promise<void>;
  /** Headline copy varies by context: first-run onboarding vs. a trial limit
   *  that was just hit mid-use. */
  title: string;
  subtitle: string;
  /** Onboarding shows this (no trial usage exists yet to block on); the
   *  trial-limit modal omits it since there's nothing left to continue with. */
  onContinueWithTrial?: () => void;
}

/** Plan cards + Razorpay subscribe flow, shared by the onboarding wizard's
 *  final step and the modal shown when a trial limit is hit mid-use
 *  (app/(tabs)/index.tsx) — kept as one component so both stay visually and
 *  behaviorally identical instead of two hand-maintained copies. */
export function PaywallView({ onSubscribed, title, subtitle, onContinueWithTrial }: Props) {
  const [subscribingPlan, setSubscribingPlan] = useState<'plus' | 'live' | null>(null);

  const handleSubscribe = async (plan: 'plus' | 'live') => {
    if (subscribingPlan) return;
    setSubscribingPlan(plan);
    try {
      await subscribeToPlan(plan);
      await onSubscribed();
    } catch (error) {
      if (error instanceof CheckoutCancelledError) return;
      logger.error('Onboarding/paywall subscribe failed', error);
      Alert.alert('Payment failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubscribingPlan(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {(['plus', 'live'] as const).map((plan) => (
        <View key={plan} style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardLabel}>{PLAN_INFO[plan].label}</Text>
              <Text style={styles.cardPrice}>{PAID_PLAN_PRICE[plan]}</Text>
            </View>
            {plan === 'live' && (
              <View style={styles.badge}>
                <Sparkles size={11} color={t.warning} />
                <Text style={styles.badgeText}>BEST</Text>
              </View>
            )}
          </View>
          {PLAN_PERKS[plan].map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <Check size={14} color={t.success} />
              <Text style={styles.perkText}>{perk}</Text>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.subscribeButton, subscribingPlan && styles.subscribeButtonDisabled]}
            onPress={() => handleSubscribe(plan)}
            disabled={!!subscribingPlan}
          >
            {subscribingPlan === plan ? (
              <ActivityIndicator size="small" color={t.bg} />
            ) : (
              <Text style={styles.subscribeButtonText}>Subscribe to {PLAN_INFO[plan].label}</Text>
            )}
          </TouchableOpacity>
        </View>
      ))}

      {onContinueWithTrial && (
        <TouchableOpacity style={styles.trialLink} onPress={onContinueWithTrial}>
          <Text style={styles.trialLinkText}>
            Continue with the free trial — 10 translations, 5 conversations, 7 days, no card needed
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: t.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: t.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  card: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cardLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: t.text,
  },
  cardPrice: {
    fontSize: 13,
    color: t.personB,
    fontWeight: '700',
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(251,191,36,0.14)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: t.warning,
    letterSpacing: 0.5,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  perkText: {
    flex: 1,
    fontSize: 13,
    color: t.textMuted,
    lineHeight: 18,
  },
  subscribeButton: {
    backgroundColor: t.personB,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
  },
  subscribeButtonDisabled: {
    opacity: 0.6,
  },
  subscribeButtonText: {
    color: t.bg,
    fontSize: 14,
    fontWeight: '800',
  },
  trialLink: {
    marginTop: 4,
    paddingVertical: 10,
  },
  trialLinkText: {
    fontSize: 13,
    color: t.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

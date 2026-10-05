import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, Square } from 'lucide-react-native';
import { canvasTheme as t } from '@/lib/canvasTheme';
import type { TranslationProgress } from '@/services/RealtimeTranslationService';

interface Props {
  progress: TranslationProgress | null;
  isActive: boolean;
  disabled?: boolean;
  onTogglePress: () => void;
  getLangName: (code: string) => string;
}

const STAGE_LABEL: Partial<Record<TranslationProgress['stage'], string>> = {
  transcribing: 'Transcribing…',
  translating: 'Translating…',
  generating_speech: 'Preparing voice…',
  playing: 'Speaking…',
  waiting: 'Get ready…',
};

/**
 * Single-sided conversation view: both the current speaker's line and the
 * translation read upright, stacked normally — no rotating the phone or
 * laying it flat between two people (that was SplitFaceToFace's "Design C",
 * replaced per explicit feedback that the face-to-face/flip mechanic wasn't
 * wanted). Same prop contract as SplitFaceToFace so this is a drop-in swap.
 */
export function ConversationTurn({ progress, isActive, disabled, onTogglePress, getLangName }: Props) {
  const speaker = progress?.currentPerson || 'A';
  const listener = speaker === 'A' ? 'B' : 'A';
  const stage = progress?.stage;
  const isRecording = stage === 'recording';
  const isPlaying = stage === 'playing' || stage === 'generating_speech';
  // A silence handover ('waiting' + error) or a hard failure ('error') carries a
  // message the user needs to see — otherwise control silently passes to the other
  // person (or the conversation silently stops) with nothing on screen to explain why,
  // which reads as the app being broken.
  const notice = progress?.error && (stage === 'waiting' || stage === 'error') ? progress.error : null;
  const noticeColor = stage === 'error' ? t.danger : t.warning;

  const speakerColor = speaker === 'A' ? t.personA : t.personB;
  const listenerColor = listener === 'A' ? t.personA : t.personB;
  const speakerBg = speaker === 'A' ? t.personABg : t.personBBg;
  const listenerBg = listener === 'A' ? t.personABg : t.personBBg;
  const speakerBorder = speaker === 'A' ? t.personABorder : t.personBBorder;
  const listenerBorder = listener === 'A' ? t.personABorder : t.personBBorder;

  const speakerLang = getLangName(progress?.currentSourceLanguage || '');
  const listenerLang = getLangName(progress?.currentTargetLanguage || '');

  return (
    <View style={styles.wrap}>
      {/* Current speaker — upright */}
      <View style={[styles.card, { backgroundColor: speakerBg, borderColor: speakerBorder }]}>
        <View style={styles.who}>
          <View style={[styles.dot, { backgroundColor: speakerColor, shadowColor: speakerColor }]} />
          <Text style={[styles.whoText, { color: speakerColor }]}>Person {speaker} · {speakerLang}</Text>
        </View>
        {progress?.sourceText ? (
          <Text style={styles.big} numberOfLines={5}>{progress.sourceText}</Text>
        ) : notice ? (
          <Text style={[styles.mutedBig, { color: noticeColor, fontWeight: '700' as any }]} numberOfLines={3}>
            {notice}
          </Text>
        ) : (
          <Text style={styles.mutedBig}>
            {isRecording ? 'Listening…' : (stage && STAGE_LABEL[stage]) || 'Ready when you are'}
          </Text>
        )}
        {isRecording && (
          <View style={styles.listening}>
            <ListeningBars color={speakerColor} />
            <Text style={[styles.listeningText, { color: speakerColor }]}>Listening</Text>
          </View>
        )}
      </View>

      {/* Translation for the other person — also upright, read normally */}
      <View style={[styles.card, { backgroundColor: listenerBg, borderColor: listenerBorder }]}>
        <View style={styles.who}>
          <View style={[styles.dot, { backgroundColor: listenerColor, shadowColor: listenerColor }]} />
          <Text style={[styles.whoText, { color: listenerColor }]}>Person {listener} · {listenerLang}</Text>
        </View>
        {progress?.translatedText ? (
          <Text style={styles.big} numberOfLines={5}>{progress.translatedText}</Text>
        ) : (
          <Text style={styles.mutedBig}>
            {isPlaying ? 'Translation is playing…' : 'Waiting for the translation…'}
          </Text>
        )}
      </View>

      {/* Mic / stop control */}
      <View style={styles.controlRow}>
        <View style={[styles.sidePerson, speaker !== 'A' && styles.sidePersonDim]}>
          <View style={[styles.sideAvatar, { borderColor: t.personA, backgroundColor: t.personABg }]}>
            <Text style={[styles.sideAvatarText, { color: t.personA }]}>A</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.mic, disabled && styles.micDisabled]}
          onPress={onTogglePress}
          disabled={disabled}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isActive ? 'Stop conversation' : 'Start conversation'}
        >
          <LinearGradient
            colors={isActive ? t.recordGradient : t.idleGradient}
            style={styles.micInner}
          >
            {isActive
              ? <Square color="#fff" size={24} fill="#fff" />
              : <Mic color="#fff" size={24} />}
          </LinearGradient>
        </TouchableOpacity>

        <View style={[styles.sidePerson, speaker !== 'B' && styles.sidePersonDim]}>
          <View style={[styles.sideAvatar, { borderColor: t.personB, backgroundColor: t.personBBg }]}>
            <Text style={[styles.sideAvatarText, { color: t.personB }]}>B</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function ListeningBars({ color }: { color: string }) {
  const heights = [6, 11, 16, 9, 14];
  return (
    <View style={styles.bars}>
      {heights.map((h, i) => (
        <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: color, marginRight: 2 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 10,
    minHeight: 110,
    justifyContent: 'center',
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  whoText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  big: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '650' as any,
    color: t.text,
    letterSpacing: -0.2,
  },
  mutedBig: {
    fontSize: 14.5,
    lineHeight: 21,
    color: t.textMuted,
  },
  listening: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listeningText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 16,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 6,
  },
  sidePerson: {
    opacity: 1,
  },
  sidePersonDim: {
    opacity: 0.4,
  },
  sideAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideAvatarText: {
    fontSize: 12,
    fontWeight: '800',
  },
  mic: {
    width: 72,
    height: 72,
    borderRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  micDisabled: {
    opacity: 0.6,
  },
  micInner: {
    flex: 1,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

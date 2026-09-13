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
 * Design C's centerpiece: the two speakers face each other across the phone,
 * so whoever is receiving the translation reads it right-side-up when the
 * phone is laid flat between them — the listening half is rotated 180°.
 */
export function SplitFaceToFace({ progress, isActive, disabled, onTogglePress, getLangName }: Props) {
  const speaker = progress?.currentPerson || 'A';
  const listener = speaker === 'A' ? 'B' : 'A';
  const stage = progress?.stage;
  const isRecording = stage === 'recording';
  const isPlaying = stage === 'playing' || stage === 'generating_speech';

  const speakerColor = speaker === 'A' ? t.personA : t.personB;
  const listenerColor = listener === 'A' ? t.personA : t.personB;
  const listenerHalfGradient = listener === 'A' ? t.personAHalfGradient : t.personBHalfGradient;
  const speakerHalfGradient = speaker === 'A' ? t.personAHalfGradient : t.personBHalfGradient;

  const speakerLang = getLangName(progress?.currentSourceLanguage || '');
  const listenerLang = getLangName(progress?.currentTargetLanguage || '');

  return (
    <View style={styles.split}>
      {/* Listener half — rotated toward the person receiving the translation */}
      <LinearGradient colors={listenerHalfGradient} style={[styles.half, styles.halfFlip]}>
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
        <View style={[styles.langtag, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
          <Text style={styles.langtagText}>{listenerLang}</Text>
        </View>
      </LinearGradient>

      {/* Speaker half — upright, whoever is speaking right now */}
      <LinearGradient colors={speakerHalfGradient} style={styles.half}>
        <View style={styles.who}>
          <View style={[styles.dot, { backgroundColor: speakerColor, shadowColor: speakerColor }]} />
          <Text style={[styles.whoText, { color: speakerColor }]}>Person {speaker} · {speakerLang}</Text>
        </View>
        {progress?.sourceText ? (
          <Text style={styles.big} numberOfLines={5}>{progress.sourceText}</Text>
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
        <View style={[styles.langtag, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
          <Text style={styles.langtagText}>{speakerLang}</Text>
        </View>
      </LinearGradient>

      {/* Center dock — rendered last (and absolutely positioned) so it paints on
          top of both halves instead of being cut off by whichever half comes
          after it in document order. */}
      <View style={styles.dockWrap} pointerEvents="box-none">
        <View style={styles.dockLine} />
        <TouchableOpacity
          style={[
            styles.dockMic,
            { backgroundColor: isActive ? t.recordGradient[0] : t.idleGradient[0] },
            disabled && { opacity: 0.6 },
          ]}
          onPress={onTogglePress}
          disabled={disabled}
          activeOpacity={0.85}
        >
          {isActive
            ? <Square color="#fff" size={24} fill="#fff" />
            : <Mic color="#fff" size={24} />}
        </TouchableOpacity>
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
  split: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    minHeight: 420,
    position: 'relative',
  },
  half: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 12,
  },
  halfFlip: {
    transform: [{ rotate: '180deg' }],
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
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '650' as any,
    color: t.text,
    letterSpacing: -0.2,
  },
  mutedBig: {
    fontSize: 15,
    lineHeight: 22,
    color: t.textMuted,
  },
  langtag: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  langtagText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.text,
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
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -31, // half of dockMic's 62px — centers it exactly on the seam
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 30,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dockMic: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import { canvasTheme as t } from '@/lib/canvasTheme';

export interface TranscriptTurn {
  id: string;
  person: 'A' | 'B';
  sourceText: string;
  translatedText: string;
  sourceLangName: string;
  targetLangName: string;
  targetLangCode: string;
}

interface Props {
  turns: TranscriptTurn[];
  onReplay: (turn: TranscriptTurn) => void;
  replayingId: string | null;
  canReplay: boolean;
  emptyHint: string;
}

/** The session's turns read back as a chat log — Design C's second screen. */
export function ChatTranscript({ turns, onReplay, replayingId, canReplay, emptyHint }: Props) {
  if (turns.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyHint}</Text>
      </View>
    );
  }

  return (
    <View>
      {turns.map((turn) => {
        const isA = turn.person === 'A';
        return (
          <View
            key={turn.id}
            style={[styles.msg, isA ? styles.msgLeft : styles.msgRight]}
          >
            <Text style={[styles.meta, { color: isA ? t.personA : t.personB, textAlign: isA ? 'left' : 'right' }]}>
              Person {turn.person} · {turn.sourceLangName}
            </Text>
            <View
              style={[
                styles.bubble1,
                { borderColor: isA ? t.personABorder : t.personBBorder, backgroundColor: isA ? t.personABg : t.personBBg },
                isA ? styles.bubbleCornerLeft : styles.bubbleCornerRight,
              ]}
            >
              <Text style={styles.bubble1Text}>{turn.sourceText}</Text>
            </View>
            <View
              style={[
                styles.bubble2,
                { backgroundColor: isA ? t.personA : t.personB },
                isA ? styles.bubbleCornerLeft : styles.bubbleCornerRight,
              ]}
            >
              <Text style={styles.bubble2Text}>{turn.translatedText}</Text>
            </View>
            <TouchableOpacity
              style={[styles.footer, { justifyContent: isA ? 'flex-start' : 'flex-end' }, !canReplay && styles.footerDisabled]}
              onPress={() => onReplay(turn)}
              disabled={replayingId === turn.id || !canReplay}
            >
              <Volume2 size={12} color={t.textFaint} />
              <Text style={styles.footerText}>
                {replayingId === turn.id ? 'Playing…' : `Replay · ${turn.targetLangName}`}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13.5,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  msg: {
    maxWidth: '88%',
    marginBottom: 16,
  },
  msgLeft: {
    marginRight: 'auto',
    alignItems: 'flex-start',
  },
  msgRight: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  meta: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  bubble1: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  bubble1Text: {
    fontSize: 14.5,
    lineHeight: 21,
    color: t.text,
  },
  bubble2: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    marginTop: 6,
  },
  bubble2Text: {
    fontSize: 15.5,
    lineHeight: 22,
    fontWeight: '600',
    color: '#fff',
  },
  bubbleCornerLeft: {
    borderBottomLeftRadius: 6,
  },
  bubbleCornerRight: {
    borderBottomRightRadius: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
  },
  footerText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.textFaint,
  },
  footerDisabled: {
    opacity: 0.4,
  },
});

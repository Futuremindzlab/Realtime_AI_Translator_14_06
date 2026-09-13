import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { ArrowLeftRight } from 'lucide-react-native';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { canvasTheme as t } from '@/lib/canvasTheme';

interface Props {
  sourceLanguage: string;
  targetLanguage: string;
  onSelectSource: (code: string) => void;
  onSelectTarget: (code: string) => void;
  onSwap: () => void;
  disabled?: boolean;
}

/**
 * The joined "From ⇄ To" pill from the Conversation Canvas design — one card,
 * a swap button docked in the middle, each half opening its own picker sheet.
 * Deliberately its own component rather than reusing LanguagePicker: that
 * component owns a full-width labeled dropdown (used elsewhere, e.g. Settings'
 * default-language prefs) and isn't built to sit side-by-side with a swap button.
 */
export function LanguagePairControl({
  sourceLanguage,
  targetLanguage,
  onSelectSource,
  onSelectTarget,
  onSwap,
  disabled,
}: Props) {
  const [pickerFor, setPickerFor] = useState<'source' | 'target' | null>(null);

  const nameOf = (code: string) => {
    if (code === 'auto') return 'Auto detect';
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    return lang?.nativeName || lang?.name || code.toUpperCase();
  };

  const openPicker = (which: 'source' | 'target') => {
    if (disabled) return;
    setPickerFor(which);
  };

  const languagesFor = (which: 'source' | 'target') =>
    SUPPORTED_LANGUAGES.filter((l) => (which === 'source' ? true : l.code !== 'auto'));

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={[styles.side, disabled && styles.sideDisabled]}
        onPress={() => openPicker('source')}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <Text style={styles.k}>From</Text>
        <Text style={styles.v} numberOfLines={1}>{nameOf(sourceLanguage)}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.swap, disabled && styles.sideDisabled]}
        onPress={disabled ? undefined : onSwap}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <ArrowLeftRight color="#fff" size={17} strokeWidth={2.5} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.side, styles.sideRight, disabled && styles.sideDisabled]}
        onPress={() => openPicker('target')}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <Text style={[styles.k, styles.kRight]}>To</Text>
        <Text style={[styles.v, styles.vRight]} numberOfLines={1}>{nameOf(targetLanguage)}</Text>
      </TouchableOpacity>

      <Modal
        visible={pickerFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pickerFor === 'source' ? 'From' : 'To'}</Text>
              <TouchableOpacity onPress={() => setPickerFor(null)}>
                <Text style={styles.doneButton}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              {pickerFor && languagesFor(pickerFor).map((lang) => {
                const selected = (pickerFor === 'source' ? sourceLanguage : targetLanguage) === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.langItem, selected && styles.langItemSelected]}
                    onPress={() => {
                      if (pickerFor === 'source') onSelectSource(lang.code);
                      else onSelectTarget(lang.code);
                      setPickerFor(null);
                    }}
                  >
                    <Text style={styles.langName}>{lang.nativeName}</Text>
                    <Text style={styles.langEnglish}>{lang.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 20,
    padding: 6,
    position: 'relative',
  },
  side: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  sideDisabled: {
    opacity: 0.5,
  },
  k: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: t.textMuted,
  },
  kRight: {
    textAlign: 'right',
  },
  v: {
    fontSize: 16,
    fontWeight: '700',
    color: t.text,
    marginTop: 5,
  },
  vRight: {
    textAlign: 'right',
  },
  swap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.personB,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginHorizontal: -4,
    zIndex: 2,
    borderWidth: 3,
    borderColor: t.bg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: 500,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.text,
  },
  doneButton: {
    fontSize: 16,
    fontWeight: '600',
    color: t.personB,
  },
  langItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  langItemSelected: {
    backgroundColor: t.personBBg,
  },
  langName: {
    fontSize: 16,
    fontWeight: '600',
    color: t.text,
    marginBottom: 2,
  },
  langEnglish: {
    fontSize: 13,
    color: t.textMuted,
  },
});

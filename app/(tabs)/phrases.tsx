import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Volume2, Plus, Search, Trash2, X } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { LanguagePairControl } from '@/components/conversation/LanguagePairControl';
import { phrasebookService, Phrase, PhraseCategory } from '@/services/phrasebookService';
import { ttsService } from '@/services/ttsService';
import { audioService } from '@/services/audioService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { canvasTheme as t } from '@/lib/canvasTheme';

const CATEGORIES: { id: 'all' | PhraseCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'travel', label: 'Travel' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'urgent', label: 'Urgent' },
];

export default function PhrasesScreen() {
  const { settings } = useAuth();
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | PhraseCategory>('all');
  const [playingId, setPlayingId] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftSource, setDraftSource] = useState('en');
  const [draftTarget, setDraftTarget] = useState(settings?.default_target_language || 'es');
  const [draftCategory, setDraftCategory] = useState<PhraseCategory>('general');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const all = await phrasebookService.getAll();
    setPhrases(all);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const getLangName = (code: string) =>
    SUPPORTED_LANGUAGES.find(l => l.code === code)?.nativeName
    ?? SUPPORTED_LANGUAGES.find(l => l.code === code)?.name
    ?? code.toUpperCase();

  const filtered = phrases.filter(p => {
    if (activeCategory !== 'all' && p.category !== activeCategory) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return p.sourceText.toLowerCase().includes(q) || p.translatedText.toLowerCase().includes(q);
  });

  const handlePlay = async (phrase: Phrase) => {
    if (playingId) return;
    setPlayingId(phrase.id);
    try {
      const uri = await ttsService.generateSpeech(
        phrase.translatedText, phrase.targetLang, settings?.tts_provider || 'device',
      );
      await audioService.forceCleanup();
      if (uri) await audioService.playAudio(uri);
    } catch (error) {
      logger.error('Phrasebook playback failed', error, { platform: Platform.OS });
      Alert.alert('Playback failed', 'Could not play this phrase. Please try again.');
    } finally {
      setPlayingId(null);
    }
  };

  const handleDelete = (phrase: Phrase) => {
    Alert.alert('Delete phrase?', phrase.sourceText, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await phrasebookService.remove(phrase.id);
          load();
        },
      },
    ]);
  };

  const openAddModal = () => {
    setDraftText('');
    setDraftCategory('general');
    setDraftTarget(settings?.default_target_language || 'es');
    setDraftSource(settings?.default_source_language === 'auto' ? 'en' : (settings?.default_source_language || 'en'));
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!draftText.trim()) return;
    setSaving(true);
    try {
      await phrasebookService.add(draftText, draftSource, draftTarget, draftCategory);
      setModalVisible(false);
      load();
    } catch (error) {
      logger.error('Failed to save phrase', error, { platform: Platform.OS });
      Alert.alert('Could not save phrase', 'Translation failed — please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Phrases</Text>
            <Text style={styles.subtitle}>Speak instantly — no mic needed</Text>
          </View>
          <TouchableOpacity style={styles.iconButton} onPress={openAddModal}>
            <Plus color={t.text} size={19} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <Search size={16} color={t.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your phrases…"
            placeholderTextColor={t.textMuted}
            value={query}
            onChangeText={setQuery}
          />
        </View>

        <View style={styles.chipsRow}>
          {CATEGORIES.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, activeCategory === c.id && styles.chipOn]}
              onPress={() => setActiveCategory(c.id)}
            >
              <Text style={[styles.chipText, activeCategory === c.id && styles.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={t.personB} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {phrases.length === 0 ? 'No saved phrases yet' : 'No phrases match'}
            </Text>
            <Text style={styles.emptyText}>
              {phrases.length === 0
                ? 'Save the lines you say often — a greeting, a price question, an emergency phrase — and play them instantly, translated, without opening the mic.'
                : 'Try a different search or category.'}
            </Text>
            {phrases.length === 0 && (
              <TouchableOpacity style={styles.emptyCta} onPress={openAddModal}>
                <Plus size={15} color="#fff" />
                <Text style={styles.emptyCtaText}>Add your first phrase</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filtered.map(phrase => (
            <View key={phrase.id} style={styles.card}>
              <TouchableOpacity
                style={styles.playIcon}
                onPress={() => handlePlay(phrase)}
                disabled={playingId === phrase.id}
              >
                {playingId === phrase.id
                  ? <ActivityIndicator size="small" color={t.personB} />
                  : <Volume2 size={16} color={t.personB} />}
              </TouchableOpacity>
              <View style={styles.cardBody}>
                <Text style={styles.cardSource}>{phrase.sourceText}</Text>
                <Text style={styles.cardTranslated}>{phrase.translatedText}</Text>
                <Text style={styles.cardLangPair}>
                  {getLangName(phrase.sourceLang)} → {getLangName(phrase.targetLang)}
                </Text>
              </View>
              <TouchableOpacity style={styles.deleteIcon} onPress={() => handleDelete(phrase)}>
                <Trash2 size={15} color={t.textFaint} />
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add phrase</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={20} color={t.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Phrase</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Where is the nearest hospital?"
                placeholderTextColor={t.textMuted}
                value={draftText}
                onChangeText={setDraftText}
                multiline
              />

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Languages</Text>
              <LanguagePairControl
                sourceLanguage={draftSource}
                targetLanguage={draftTarget}
                onSelectSource={setDraftSource}
                onSelectTarget={setDraftTarget}
                onSwap={() => { setDraftSource(draftTarget); setDraftTarget(draftSource); }}
              />

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Category</Text>
              <View style={styles.chipsRow}>
                {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, draftCategory === c.id && styles.chipOn]}
                    onPress={() => setDraftCategory(c.id as PhraseCategory)}
                  >
                    <Text style={[styles.chipText, draftCategory === c.id && styles.chipTextOn]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.saveButton, (!draftText.trim() || saving) && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={!draftText.trim() || saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveButtonText}>Translate & save</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scrollContent: { padding: 16, paddingTop: Platform.OS === 'ios' ? 60 : 40 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18,
  },
  title: { fontSize: 26, fontWeight: '800', color: t.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 13.5, color: t.textMuted, marginTop: 3 },
  iconButton: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: t.card,
    borderWidth: 1, borderColor: t.cardBorder, alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 13,
    borderRadius: 15, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: t.text, padding: 0 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999,
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
  },
  chipOn: { backgroundColor: t.text, borderColor: t.text },
  chipText: { fontSize: 11.5, fontWeight: '700', color: t.textMuted },
  chipTextOn: { color: t.bg },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 18,
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 10,
  },
  playIcon: {
    width: 34, height: 34, borderRadius: 12, backgroundColor: t.personBBg,
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardSource: { fontSize: 14, fontWeight: '650' as any, color: t.text },
  cardTranslated: { fontSize: 12.5, color: t.textMuted, marginTop: 3 },
  cardLangPair: { fontSize: 10.5, fontWeight: '700', color: t.textFaint, marginTop: 5, letterSpacing: 0.3 },
  deleteIcon: { padding: 6 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 8 },
  emptyText: { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18,
    backgroundColor: t.personB, paddingVertical: 11, paddingHorizontal: 18, borderRadius: 12,
  },
  emptyCtaText: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: t.bgElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%', paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: t.cardBorder,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: t.text },
  modalScroll: { padding: 20 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: t.textMuted, marginBottom: 8 },
  textInput: {
    borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    padding: 14, fontSize: 15, color: t.text, minHeight: 64, textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 22, backgroundColor: t.personB, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  saveButtonText: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
});

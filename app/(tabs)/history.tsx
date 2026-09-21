import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Play, Trash2, Languages, ChevronDown, X } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { dynamoService } from '@/services/dynamoService';
import { ConversationHistory } from '@/types';
import { audioService } from '@/services/audioService';
import { ttsService } from '@/services/ttsService';
import { translationProvider } from '@/services/translationProvider';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { canvasTheme as t } from '@/lib/canvasTheme';

// Languages available for replay (no 'auto' option)
const REPLAY_LANGUAGES = SUPPORTED_LANGUAGES.filter(l => l.code !== 'auto');

// History always shows the 5 most recent conversations, for every account —
// no role-based carve-out (see the account/view-mode cleanup this shipped
// alongside; owner vs. regular-customer accounts see identical History).
const HISTORY_DISPLAY_LIMIT = 5;

export default function HistoryScreen() {
  const { user, settings } = useAuth();

  const [history, setHistory] = useState<ConversationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Replay state
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayLangs, setReplayLangs] = useState<Record<string, string>>({});
  const [langPickerItem, setLangPickerItem] = useState<ConversationHistory | null>(null);

  // Sync TTS voice gender from settings whenever they load
  useEffect(() => {
    if (settings?.voice_gender) ttsService.setVoiceGender(settings.voice_gender);
    if (settings?.selected_voice_id !== undefined) ttsService.setSelectedVoiceId(settings.selected_voice_id ?? null);
    if (settings?.custom_voice_id !== undefined) ttsService.setCustomVoiceId(settings.custom_voice_id ?? null);
  }, [settings]);

  const loadHistory = useCallback(async () => {
    if (!user || !dynamoService.isInitialized()) {
      setLoading(false);
      return;
    }
    try {
      const data = await dynamoService.getConversationHistory(user.id, HISTORY_DISPLAY_LIMIT);
      setHistory(data);
    } catch (error) {
      console.error('Error in loadHistory:', error);
      Alert.alert('Error', 'Failed to load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadHistory();
      } else {
        setLoading(false);
      }
    }, [user, loadHistory])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadHistory();
  };

  // ---------- Replay logic ----------

  const getReplayLang = (item: ConversationHistory): string =>
    replayLangs[item.id] ?? item.target_language;

  const handleReplay = async (item: ConversationHistory) => {
    if (replayingId) return;
    const targetLang = getReplayLang(item);
    const isDifferentLang = targetLang !== item.target_language;
    setReplayingId(item.id);
    try {
      // Same language as originally translated + audio was persisted to S3 at
      // save time — stream the stored clip instead of paying for re-synthesis.
      if (!isDifferentLang && item.translated_audio_key) {
        const url = await dynamoService.getAudioUrl(item.timestamp, 'translated');
        if (url) {
          await audioService.playAudio(url);
          return;
        }
        // Fall through to re-synthesis if the stored audio couldn't be fetched
        // (e.g. it expired out of S3 but the DynamoDB reference lagged behind).
      }

      let text = item.translated_text;

      // Re-translate when user chose a different target language
      if (isDifferentLang) {
        if (!item.source_text?.trim()) {
          throw new Error('Original text not available for re-translation');
        }
        text = '';
        await translationProvider.translate(
          item.source_text,
          item.source_language,
          targetLang,
          (chunk) => { text += chunk; }
        );
        if (!text.trim()) throw new Error('Translation returned an empty result');
      }

      const provider = settings?.tts_provider ?? 'openai';
      const uri = await ttsService.generateSpeech(text, targetLang, provider as any);
      if (uri) await audioService.playAudio(uri);
    } catch (err: any) {
      Alert.alert(
        'Replay Failed',
        err?.message ?? 'Could not generate audio. Check your internet connection.'
      );
    } finally {
      setReplayingId(null);
    }
  };

  // ---------- Delete logic ----------

  const handleDeleteItem = async (id: string) => {
    Alert.alert(
      'Delete Translation',
      'Are you sure you want to delete this translation from your history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!user) throw new Error('No user');
              const item = history.find(h => h.id === id);
              if (item) {
                await dynamoService.deleteConversationHistoryItem(user.id, item.timestamp);
              }
              setHistory(history.filter((h) => h.id !== id));
            } catch (error) {
              console.error('Error deleting item:', error);
              Alert.alert('Error', 'Failed to delete translation');
            }
          },
        },
      ]
    );
  };

  const handleClearHistory = async () => {
    if (!user) return;
    Alert.alert(
      'Clear All History',
      'Are you sure you want to delete all your translation history? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await dynamoService.clearConversationHistory(user.id);
              setHistory([]);
            } catch (error) {
              console.error('Error clearing history:', error);
              Alert.alert('Error', 'Failed to clear history');
            }
          },
        },
      ]
    );
  };

  // ---------- Helpers ----------

  const getLanguageName = (code: string): string =>
    SUPPORTED_LANGUAGES.find(l => l.code === code)?.name ?? code.toUpperCase();

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // ---------- Render ----------

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <Languages size={64} color={t.textFaint} />
        <Text style={styles.emptyTitle}>Sign In Required</Text>
        <Text style={styles.emptyText}>
          Please sign in from the Settings tab to view your translation history.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={t.personB} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>Last {HISTORY_DISPLAY_LIMIT} translations</Text>
        </View>
        {history.length > 0 && (
          <TouchableOpacity onPress={handleClearHistory} style={styles.clearButton}>
            <Trash2 size={20} color={t.danger} />
            <Text style={styles.clearButtonText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Languages size={64} color={t.textFaint} />
          <Text style={styles.emptyTitle}>No History Yet</Text>
          <Text style={styles.emptyText}>
            Your translation history will appear here after you make your first translation.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }>
          {history.map((item) => {
            const replayLang = getReplayLang(item);
            const isReplaying = replayingId === item.id;
            const isDifferentLang = replayLang !== item.target_language;
            return (
              <View key={item.id} style={styles.historyCard}>
                {/* Card header */}
                <View style={styles.cardHeader}>
                  <View style={styles.languageInfo}>
                    <Text style={styles.languageText}>
                      {getLanguageName(item.source_language)} → {getLanguageName(item.target_language)}
                    </Text>
                    <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteItem(item.id)}
                    style={styles.deleteButton}>
                    <Trash2 size={18} color={t.danger} />
                  </TouchableOpacity>
                </View>

                {/* Source text */}
                <View style={styles.textBlock}>
                  <Text style={styles.textLabel}>Original</Text>
                  <Text style={styles.textContent}>{item.source_text}</Text>
                </View>

                {/* Translation text */}
                <View style={styles.textBlock}>
                  <Text style={styles.textLabel}>Translation</Text>
                  <Text style={styles.textContent}>{item.translated_text}</Text>
                </View>

                {/* ── Replay bar ── */}
                <View style={styles.replayBar}>
                  {/* Replay button */}
                  <TouchableOpacity
                    style={[styles.replayButton, isReplaying && styles.replayButtonActive]}
                    onPress={() => handleReplay(item)}
                    disabled={!!replayingId}
                    activeOpacity={0.8}>
                    {isReplaying ? (
                      <ActivityIndicator size="small" color={t.bg} />
                    ) : (
                      <>
                        <Play size={15} color={t.bg} fill={t.bg} />
                        <Text style={styles.replayButtonText}>
                          {isDifferentLang ? `Play in ${getLanguageName(replayLang)}` : 'Replay'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Language picker pill */}
                  <TouchableOpacity
                    style={[styles.langPill, isDifferentLang && styles.langPillChanged]}
                    onPress={() => setLangPickerItem(item)}
                    disabled={!!replayingId}
                    activeOpacity={0.7}>
                    <Text
                      style={[styles.langPillText, isDifferentLang && styles.langPillTextChanged]}
                      numberOfLines={1}>
                      {getLanguageName(replayLang)}
                    </Text>
                    <ChevronDown size={13} color={isDifferentLang ? t.personB : t.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* ── Language Picker Modal ── */}
      <Modal
        visible={langPickerItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLangPickerItem(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setLangPickerItem(null)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Replay Language</Text>
              <TouchableOpacity onPress={() => setLangPickerItem(null)} style={styles.modalCloseBtn}>
                <X size={20} color={t.textMuted} />
              </TouchableOpacity>
            </View>
            {langPickerItem && (
              <Text style={styles.modalSubtitle}>
                Original: {getLanguageName(langPickerItem.target_language)}
              </Text>
            )}
            <FlatList
              data={REPLAY_LANGUAGES}
              keyExtractor={(l) => l.code}
              style={styles.langList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: lang }) => {
                const isSelected = langPickerItem
                  ? getReplayLang(langPickerItem) === lang.code
                  : false;
                const isOriginal = langPickerItem
                  ? lang.code === langPickerItem.target_language
                  : false;
                return (
                  <TouchableOpacity
                    style={[styles.langOption, isSelected && styles.langOptionSelected]}
                    onPress={() => {
                      if (langPickerItem) {
                        setReplayLangs(prev => ({
                          ...prev,
                          [langPickerItem.id]: lang.code,
                        }));
                      }
                      setLangPickerItem(null);
                    }}>
                    <Text style={[styles.langOptionText, isSelected && styles.langOptionTextSelected]}>
                      {lang.name}
                    </Text>
                    {isOriginal && !isSelected && (
                      <Text style={styles.langOptionOriginalBadge}>original</Text>
                    )}
                    {isSelected && <Text style={styles.langOptionCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.bg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: t.bg,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: t.text,
    marginTop: 20,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    backgroundColor: t.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: t.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: t.textMuted,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.danger,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  historyCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  languageInfo: {
    flex: 1,
  },
  languageText: {
    fontSize: 15,
    fontWeight: '600',
    color: t.personB,
    marginBottom: 3,
  },
  dateText: {
    fontSize: 12,
    color: t.textMuted,
  },
  deleteButton: {
    padding: 4,
    marginLeft: 8,
  },
  textBlock: {
    marginBottom: 10,
  },
  textLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.textFaint,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  textContent: {
    fontSize: 15,
    color: t.text,
    lineHeight: 22,
  },

  // ── Replay bar ──
  replayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: t.cardBorder,
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.personB,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minWidth: 90,
    justifyContent: 'center',
  },
  replayButtonActive: {
    opacity: 0.85,
  },
  replayButtonText: {
    color: t.bg,
    fontSize: 13,
    fontWeight: '600',
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.bgElevated,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    flex: 1,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  langPillChanged: {
    backgroundColor: t.personBBg,
    borderWidth: 1,
    borderColor: t.personBBorder,
  },
  langPillText: {
    fontSize: 13,
    color: t.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  langPillTextChanged: {
    color: t.personB,
    fontWeight: '600',
  },

  // ── Language picker modal ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: t.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: t.cardBorderStrong,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: t.text,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: t.textFaint,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  langList: {
    flex: 1,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  langOptionSelected: {
    backgroundColor: t.personBBg,
  },
  langOptionText: {
    fontSize: 15,
    color: t.text,
    flex: 1,
  },
  langOptionTextSelected: {
    color: t.personB,
    fontWeight: '600',
  },
  langOptionOriginalBadge: {
    fontSize: 11,
    color: t.textFaint,
    backgroundColor: t.card,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  langOptionCheck: {
    fontSize: 15,
    color: t.personB,
    fontWeight: '700',
  },
});

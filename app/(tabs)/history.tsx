import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Play, Trash2, Languages } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { dynamoService } from '@/services/dynamoService';
import { ConversationHistory } from '@/types';
import { audioService } from '@/services/audioService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';

export default function HistoryScreen() {
  const { user, viewMode } = useAuth();
  const isUserView = user?.role === 'USER' || viewMode === 'user';
  const [history, setHistory] = useState<ConversationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Reload history every time the tab is focused
  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadHistory();
      } else {
        setLoading(false);
      }
    }, [user])
  );

  const loadHistory = async () => {
    if (!user || !dynamoService.isInitialized()) {
      setLoading(false);
      return;
    }

    try {
      const data = await dynamoService.getConversationHistory(user.id, isUserView ? 5 : undefined);
      setHistory(data);
    } catch (error) {
      console.error('Error in loadHistory:', error);
      Alert.alert('Error', 'Failed to load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadHistory();
  };

  const handlePlayAudio = async (audioUrl: string, id: string) => {
    try {
      setPlayingId(id);
      await audioService.playAudio(audioUrl);
      setPlayingId(null);
    } catch (error) {
      console.error('Error playing audio:', error);
      Alert.alert('Error', 'Failed to play audio');
      setPlayingId(null);
    }
  };

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
              Alert.alert('Success', 'Translation deleted');
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
              Alert.alert('Success', 'History cleared');
            } catch (error) {
              console.error('Error clearing history:', error);
              Alert.alert('Error', 'Failed to clear history');
            }
          },
        },
      ]
    );
  };

  const getLanguageName = (code: string): string => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    return lang ? lang.name : code.toUpperCase();
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
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

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <Languages size={64} color="#d1d5db" />
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
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>
            {isUserView
              ? 'Last 5 translations'
              : `${history.length} translation${history.length !== 1 ? 's' : ''}`}
          </Text>
        </View>
        {history.length > 0 && !isUserView && (
          <TouchableOpacity onPress={handleClearHistory} style={styles.clearButton}>
            <Trash2 size={20} color="#ef4444" />
            <Text style={styles.clearButtonText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Languages size={64} color="#d1d5db" />
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
          {history.map((item) => (
            <View key={item.id} style={styles.historyCard}>
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
                  <Trash2 size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>

              <View style={styles.textBlock}>
                <Text style={styles.textLabel}>Original</Text>
                <Text style={styles.textContent}>{item.source_text}</Text>
              </View>

              <View style={styles.textBlock}>
                <Text style={styles.textLabel}>Translation</Text>
                <Text style={styles.textContent}>{item.translated_text}</Text>
              </View>

              {item.translated_audio_url && (
                <TouchableOpacity
                  style={[
                    styles.playButton,
                    playingId === item.id && styles.playButtonActive,
                  ]}
                  onPress={() => handlePlayAudio(item.translated_audio_url!, item.id)}
                  disabled={playingId === item.id}>
                  {playingId === item.id ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Play size={18} color="#ffffff" fill="#ffffff" />
                      <Text style={styles.playButtonText}>Play Translation</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#374151',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 40,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
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
    color: '#ef4444',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  languageInfo: {
    flex: 1,
  },
  languageText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 12,
    color: '#6b7280',
  },
  deleteButton: {
    padding: 4,
  },
  textBlock: {
    marginBottom: 12,
  },
  textLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textContent: {
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
  },
  playButton: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  playButtonActive: {
    backgroundColor: '#1d4ed8',
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

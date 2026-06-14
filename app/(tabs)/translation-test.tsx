import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { translationProvider } from '@/services/translationProvider';
import { ttsService } from '@/services/ttsService';
import { audioService } from '@/services/audioService';

export default function TranslationTestScreen() {
  const [provider, setProvider] = useState<'openai' | 'device'>(translationProvider.getProvider());
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('es');
  const [inputText, setInputText] = useState('Hello world');
  const [outputText, setOutputText] = useState('');
  const [loading, setLoading] = useState(false);

  const runTranslate = async () => {
    if (!inputText || inputText.trim().length === 0) return Alert.alert('Enter text to translate');

    setOutputText('');
    setLoading(true);

    try {
      translationProvider.setProvider(provider);

      const result = await translationProvider.translate(inputText, sourceLang, targetLang, (chunk) => {
        setOutputText((prev) => prev + chunk);
      });

      // Ensure UI shows final result
      setOutputText(result);
    } catch (err: any) {
      Alert.alert('Translation error', err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const playTTS = async () => {
    try {
      const uri = await ttsService.generateSpeech(outputText || inputText, targetLang, 'device' as any);
      if (uri) {
        await audioService.playAudio(uri);
      } else {
        Alert.alert('TTS', 'Spoken via device TTS (no file)');
      }
    } catch (err: any) {
      Alert.alert('TTS error', err?.message || String(err));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Translation Test</Text>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.option, provider === 'openai' && styles.optionSelected]} onPress={() => setProvider('openai')}>
          <Text style={styles.optionText}>OpenAI (cloud)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.option, provider === 'device' && styles.optionSelected]} onPress={() => setProvider('device')}>
          <Text style={styles.optionText}>Device (offline)</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Source language (ISO code)</Text>
      <TextInput style={styles.input} value={sourceLang} onChangeText={setSourceLang} />

      <Text style={styles.label}>Target language (ISO code)</Text>
      <TextInput style={styles.input} value={targetLang} onChangeText={setTargetLang} />

      <Text style={styles.label}>Input text</Text>
      <TextInput style={[styles.input, styles.multiline]} value={inputText} onChangeText={setInputText} multiline />

      <TouchableOpacity style={styles.primaryButton} onPress={runTranslate} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Translate</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>Output (streamed)</Text>
      <View style={styles.outputBox}>
        <Text>{outputText || (loading ? 'Translating…' : '—')}</Text>
      </View>

      <View style={styles.rowButtons}>
        <TouchableOpacity style={styles.secondaryButton} onPress={playTTS} disabled={!outputText && !inputText}>
          <Text style={styles.secondaryButtonText}>Play TTS (device)</Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  option: { padding: 10, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  optionSelected: { backgroundColor: '#eef2ff', borderColor: '#2563eb' },
  optionText: { color: '#111827' },
  label: { marginTop: 12, marginBottom: 6, color: '#374151', fontWeight: '600' },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  multiline: { minHeight: 80, textAlignVertical: 'top' as const },
  primaryButton: { marginTop: 12, backgroundColor: '#2563eb', padding: 14, borderRadius: 8, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  outputBox: { minHeight: 120, backgroundColor: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', marginTop: 8 },
  secondaryButton: { marginTop: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#2563eb', padding: 12, borderRadius: 8 },
  secondaryButtonText: { color: '#2563eb', fontWeight: '600' },
  rowButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
});

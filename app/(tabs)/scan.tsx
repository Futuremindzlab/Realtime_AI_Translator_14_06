import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Images, RotateCcw, ScanText, Camera as CameraIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { LanguagePicker } from '@/components/LanguagePicker';
import { scanAndTranslate, ScanTranslateResult } from '@/services/ocrTranslateService';
import { prepareImageForScan } from '@/lib/imagePrep';
import { logger } from '@/lib/logger';
import { canvasTheme as t } from '@/lib/canvasTheme';

type Stage = 'camera' | 'scanning' | 'result';

export default function ScanScreen() {
  const { settings } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [targetLanguage, setTargetLanguage] = useState(settings?.default_target_language || 'es');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [result, setResult] = useState<ScanTranslateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Seed the target-language picker from the account default the first time
  // this screen is visited, same as other screens that read it from settings —
  // doesn't fight the user's own in-screen choice on later visits.
  const seededRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seededRef.current && settings?.default_target_language) {
        seededRef.current = true;
        setTargetLanguage(settings.default_target_language);
      }
    }, [settings?.default_target_language])
  );

  const runScan = async (uri: string) => {
    setPreviewUri(uri);
    setStage('scanning');
    setError(null);
    setResult(null);
    try {
      const prepared = await prepareImageForScan(uri);
      const scanResult = await scanAndTranslate(prepared.base64, targetLanguage);
      setResult(scanResult);
    } catch (err: any) {
      logger.error('Scan & translate failed', err);
      setError(err?.message || 'Could not read that photo. Please try again.');
    } finally {
      setStage('result');
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      await runScan(photo.uri);
    } catch (err: any) {
      logger.error('Camera capture failed', err);
      setError(err?.message || 'Could not take photo. Please try again.');
      setStage('result');
    } finally {
      setCapturing(false);
    }
  };

  const handlePickFromLibrary = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    await runScan(picked.assets[0].uri);
  };

  const reset = () => {
    setStage('camera');
    setPreviewUri(null);
    setResult(null);
    setError(null);
  };

  // ---------- Permission still loading ----------
  if (!permission) {
    return <View style={styles.container} />;
  }

  // ---------- Permission gate ----------
  if (!permission.granted) {
    // Once denied with canAskAgain: false (iOS after one refusal; Android
    // after "Don't ask again"), calling requestPermission() again just
    // silently resolves with the same denied status — the only way back in
    // is the OS Settings app, so point there instead of a dead-end retry.
    const permanentlyDenied = !permission.canAskAgain;
    return (
      <View style={[styles.container, styles.centered]}>
        <View style={styles.permissionIconWrap}>
          <ScanText size={40} color={t.personB} />
        </View>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>
          {permanentlyDenied
            ? 'Camera access is currently off for The OneLingo. Turn it on in Settings to scan text, or choose a photo instead.'
            : 'The OneLingo uses your camera to read and translate signs, menus, and other printed text you point it at.'}
        </Text>
        <TouchableOpacity
          style={styles.primaryButtonWrap}
          onPress={permanentlyDenied ? () => Linking.openSettings() : requestPermission}
          activeOpacity={0.85}
        >
          <LinearGradient colors={t.idleGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{permanentlyDenied ? 'Open Settings' : 'Allow camera access'}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handlePickFromLibrary}>
          <Text style={styles.secondaryButtonText}>Choose a photo instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- Scanning / result stage ----------
  if (stage === 'scanning' || stage === 'result') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan & Translate</Text>
        </View>

        <ScrollView
          style={styles.resultBody}
          contentContainerStyle={styles.resultBodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {previewUri && <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="cover" />}

          {stage === 'scanning' && (
            <View style={styles.resultCard}>
              <View style={styles.scanningRow}>
                <ActivityIndicator color={t.personB} />
                <Text style={styles.scanningText}>Reading and translating…</Text>
              </View>
            </View>
          )}

          {stage === 'result' && error && (
            <View style={styles.resultCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {stage === 'result' && !error && result && !result.found && (
            <View style={styles.resultCard}>
              <Text style={styles.errorText}>
                Couldn&apos;t find any readable text in that photo. Try getting closer, or make sure the text is in focus.
              </Text>
            </View>
          )}

          {stage === 'result' && !error && result && result.found && (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>
                {result.detectedLanguage ? `Detected · ${result.detectedLanguage}` : 'Original text'}
              </Text>
              <Text style={styles.detectedText}>{result.detectedText}</Text>

              <View style={styles.divider} />

              <Text style={styles.resultLabel}>Translation</Text>
              <Text style={styles.translatedText}>{result.translatedText}</Text>
            </View>
          )}
        </ScrollView>

        {stage === 'result' && (
          <TouchableOpacity style={styles.primaryButtonWrap} onPress={reset} activeOpacity={0.85}>
            <LinearGradient colors={t.idleGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
              <RotateCcw size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Scan again</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ---------- Camera stage ----------
  return (
    <View style={styles.container}>
      <View style={styles.languageRow}>
        <LanguagePicker label="Translate to" selectedLanguage={targetLanguage} onSelectLanguage={setTargetLanguage} />
      </View>

      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.cameraOverlay}>
            <Text style={styles.hint}>Point the camera at text to translate</Text>
          </View>
        </CameraView>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.galleryButton} onPress={handlePickFromLibrary} accessibilityLabel="Choose from photos">
          <Images size={22} color={t.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.captureButtonWrap}
          onPress={handleCapture}
          disabled={capturing}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
        >
          <LinearGradient colors={t.idleGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.captureButton}>
            {capturing ? <ActivityIndicator color="#fff" /> : <CameraIcon size={28} color="#fff" />}
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.galleryButtonSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  header: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    backgroundColor: t.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: t.text,
  },

  // Permission gate
  permissionIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: t.personBBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: t.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 15,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  secondaryButton: {
    marginTop: 14,
    padding: 10,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.personB,
  },

  // Shared gradient button
  primaryButtonWrap: {
    marginHorizontal: 20,
    marginBottom: Platform.OS === 'ios' ? 20 : 16,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: t.personB,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  primaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Camera stage
  languageRow: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    backgroundColor: t.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  cameraWrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },
  hint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    backgroundColor: t.bgElevated,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  galleryButtonSpacer: {
    width: 48,
    height: 48,
  },
  captureButtonWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    elevation: 8,
    shadowColor: t.personB,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  captureButton: {
    width: '100%',
    height: '100%',
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Result stage
  resultBody: {
    flex: 1,
  },
  resultBodyContent: {
    padding: 20,
    paddingBottom: 32,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: t.card,
  },
  resultCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
    padding: 18,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scanningText: {
    fontSize: 15,
    color: t.textMuted,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 15,
    color: t.textMuted,
    lineHeight: 22,
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: t.textFaint,
    marginBottom: 6,
  },
  detectedText: {
    fontSize: 17,
    color: t.text,
    lineHeight: 24,
  },
  divider: {
    height: 1,
    backgroundColor: t.cardBorder,
    marginVertical: 16,
  },
  translatedText: {
    fontSize: 20,
    fontWeight: '600',
    color: t.personB,
    lineHeight: 28,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';

interface LanguagePickerProps {
  label: string;
  selectedLanguage: string;
  onSelectLanguage: (languageCode: string) => void;
  excludeLanguage?: string;
  allowAuto?: boolean;
  disabled?: boolean;
}

export const LanguagePicker: React.FC<LanguagePickerProps> = ({
  label,
  selectedLanguage,
  onSelectLanguage,
  excludeLanguage,
  allowAuto = false,
  disabled = false,
}) => {
  const [modalVisible, setModalVisible] = React.useState(false);

  const selectedLang = SUPPORTED_LANGUAGES.find((lang) => lang.code === selectedLanguage);
  const availableLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) => lang.code !== excludeLanguage && (allowAuto || lang.code !== 'auto')
  );


  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.selector, disabled && { opacity: 0.5 }]}
        onPress={() => { if (!disabled) setModalVisible(true); }}
        activeOpacity={disabled ? 1 : 0.7}>
        <Text style={styles.selectedText}>
          {selectedLang
            ? selectedLang.nativeName === selectedLang.name
              ? selectedLang.name
              : `${selectedLang.nativeName} (${selectedLang.name})`
            : 'Select Language'}
        </Text>
        <ChevronDown size={20} color="#6b7280" />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.doneButton}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.languageList}
              contentContainerStyle={styles.languageListContent}
              showsVerticalScrollIndicator={true}
            >
              {availableLanguages.length === 0 ? (
                <Text style={styles.noLanguagesText}>No languages available</Text>
              ) : (
                availableLanguages.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    style={[
                      styles.languageItem,
                      selectedLanguage === language.code && styles.languageItemSelected,
                    ]}
                    onPress={() => {
                      onSelectLanguage(language.code);
                      setModalVisible(false);
                    }}>
                    <Text style={styles.languageName}>{language.nativeName}</Text>
                    <Text style={styles.languageEnglishName}>{language.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  selector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedText: {
    fontSize: 16,
    color: '#111827',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: 500,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  doneButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  languageList: {
    flex: 1,
  },
  languageListContent: {
    paddingBottom: 20,
  },
  noLanguagesText: {
    padding: 20,
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 16,
  },
  languageItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#ffffff',
  },
  languageItemSelected: {
    backgroundColor: '#eff6ff',
  },
  languageName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 4,
  },
  languageEnglishName: {
    fontSize: 14,
    color: '#6b7280',
  },
});

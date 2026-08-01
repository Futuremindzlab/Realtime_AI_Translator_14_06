import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';
import { PickerSheet, pickerStyles } from '@/components/PickerSheet';

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

      <PickerSheet
        visible={modalVisible}
        title={label}
        onClose={() => setModalVisible(false)}
        listStyle={styles.languageList}>
        {availableLanguages.length === 0 ? (
          <Text style={styles.noLanguagesText}>No languages available</Text>
        ) : (
          availableLanguages.map((language) => (
            <TouchableOpacity
              key={language.code}
              style={[
                styles.languageItem,
                selectedLanguage === language.code && pickerStyles.itemSelected,
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
      </PickerSheet>
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
    ...pickerStyles.selector,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedText: {
    ...pickerStyles.selectedText,
    flex: 1,
  },
  languageList: {
    flex: 1,
  },
  noLanguagesText: {
    padding: 20,
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 16,
  },
  languageItem: {
    ...pickerStyles.item,
    backgroundColor: '#ffffff',
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

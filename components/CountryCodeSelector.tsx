import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

export interface CountryCode {
  dialCode: string;
  name: string;
  flag: string;
}

// Curated list of common country codes. India defaults first given the app's
// Indic-language focus; extend this list as needed.
export const COUNTRY_CODES: CountryCode[] = [
  { dialCode: '+91',  name: 'India',          flag: '🇮🇳' },
  { dialCode: '+1',   name: 'United States',  flag: '🇺🇸' },
  { dialCode: '+44',  name: 'United Kingdom', flag: '🇬🇧' },
  { dialCode: '+61',  name: 'Australia',      flag: '🇦🇺' },
  { dialCode: '+971', name: 'UAE',            flag: '🇦🇪' },
  { dialCode: '+65',  name: 'Singapore',      flag: '🇸🇬' },
  { dialCode: '+60',  name: 'Malaysia',       flag: '🇲🇾' },
  { dialCode: '+966', name: 'Saudi Arabia',   flag: '🇸🇦' },
  { dialCode: '+974', name: 'Qatar',          flag: '🇶🇦' },
  { dialCode: '+49',  name: 'Germany',        flag: '🇩🇪' },
  { dialCode: '+33',  name: 'France',         flag: '🇫🇷' },
  { dialCode: '+81',  name: 'Japan',          flag: '🇯🇵' },
  { dialCode: '+86',  name: 'China',          flag: '🇨🇳' },
  { dialCode: '+94',  name: 'Sri Lanka',      flag: '🇱🇰' },
  { dialCode: '+880', name: 'Bangladesh',     flag: '🇧🇩' },
];

interface CountryCodeSelectorProps {
  selectedDialCode: string;
  onSelect: (dialCode: string) => void;
}

export const CountryCodeSelector: React.FC<CountryCodeSelectorProps> = ({
  selectedDialCode,
  onSelect,
}) => {
  const [modalVisible, setModalVisible] = React.useState(false);
  const selected = COUNTRY_CODES.find((c) => c.dialCode === selectedDialCode) || COUNTRY_CODES[0];

  return (
    <View>
      <TouchableOpacity style={styles.selector} onPress={() => setModalVisible(true)}>
        <Text style={styles.selectedText}>{selected.flag} {selected.dialCode}</Text>
        <ChevronDown size={18} color="#6b7280" />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Country Code</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.doneButton}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              {COUNTRY_CODES.map((c) => (
                <TouchableOpacity
                  key={c.dialCode + c.name}
                  style={[
                    styles.item,
                    selectedDialCode === c.dialCode && styles.itemSelected,
                  ]}
                  onPress={() => {
                    onSelect(c.dialCode);
                    setModalVisible(false);
                  }}>
                  <Text style={styles.itemText}>{c.flag}  {c.name}</Text>
                  <Text style={styles.itemDialCode}>{c.dialCode}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minWidth: 100,
  },
  selectedText: {
    fontSize: 16,
    color: '#111827',
    marginRight: 6,
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
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  itemSelected: {
    backgroundColor: '#eff6ff',
  },
  itemText: {
    fontSize: 16,
    color: '#111827',
  },
  itemDialCode: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '600',
  },
});

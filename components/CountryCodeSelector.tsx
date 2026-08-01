import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { PickerSheet, pickerStyles } from '@/components/PickerSheet';

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

      <PickerSheet
        visible={modalVisible}
        title="Country Code"
        onClose={() => setModalVisible(false)}>
        {COUNTRY_CODES.map((c) => (
          <TouchableOpacity
            key={c.dialCode + c.name}
            style={[styles.item, selectedDialCode === c.dialCode && pickerStyles.itemSelected]}
            onPress={() => {
              onSelect(c.dialCode);
              setModalVisible(false);
            }}>
            <Text style={styles.itemText}>{c.flag}  {c.name}</Text>
            <Text style={styles.itemDialCode}>{c.dialCode}</Text>
          </TouchableOpacity>
        ))}
      </PickerSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  selector: {
    ...pickerStyles.selector,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minWidth: 100,
  },
  selectedText: {
    ...pickerStyles.selectedText,
    marginRight: 6,
  },
  item: {
    ...pickerStyles.item,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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

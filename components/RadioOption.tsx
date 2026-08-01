import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface RadioOptionProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}

/** Radio row used throughout Settings: filled circle, label and helper text. */
export const RadioOption: React.FC<RadioOptionProps> = ({ label, description, selected, onPress }) => (
  <TouchableOpacity style={styles.option} onPress={onPress}>
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected && <View style={styles.radioDot} />}
    </View>
    <View>
      <Text style={styles.label}>{label}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    gap: 12,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: '#2563eb',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  label: {
    fontSize: 16,
    color: '#374151',
  },
  description: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
});

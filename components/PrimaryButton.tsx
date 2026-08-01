import React from 'react';
import {
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from 'react-native';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  /** Rendered to the left of the title while not loading. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Filled call-to-action button that swaps its content for a spinner while busy. */
export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title,
  onPress,
  loading = false,
  icon,
  style,
}) => (
  <TouchableOpacity style={[styles.button, style]} onPress={onPress} disabled={loading}>
    {loading ? (
      <ActivityIndicator size="small" color="#ffffff" />
    ) : (
      <>
        {icon}
        <Text style={styles.text}>{title}</Text>
      </>
    )}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

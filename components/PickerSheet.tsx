import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';

interface PickerSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  listStyle?: StyleProp<ViewStyle>;
}

/**
 * Bottom-sheet modal shared by the picker components: dimmed overlay, rounded
 * sheet with a title/Done header, and a scrollable list of options.
 */
export const PickerSheet: React.FC<PickerSheetProps> = ({
  visible,
  title,
  onClose,
  children,
  listStyle,
}) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneButton}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={listStyle} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
          {children}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

/** Base styles the pickers extend for their trigger and option rows. */
export const pickerStyles: {
  selector: ViewStyle;
  selectedText: TextStyle;
  item: ViewStyle;
  itemSelected: ViewStyle;
} = {
  selector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
  },
  selectedText: {
    fontSize: 16,
    color: '#111827',
  },
  item: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  itemSelected: {
    backgroundColor: '#eff6ff',
  },
};

const styles = StyleSheet.create({
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
  listContent: {
    paddingBottom: 20,
  },
});

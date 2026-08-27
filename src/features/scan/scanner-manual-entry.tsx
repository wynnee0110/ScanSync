import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Palette } from '@/constants/palette';

export interface ScannerManualEntryProps {
  onVerified?: (studentName: string, idNumber: string, course: string) => void;
}

export function ScannerManualEntry({ onVerified }: ScannerManualEntryProps) {
  const [visible, setVisible] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [course, setCourse] = useState('');

  const handleClose = () => {
    setVisible(false);
    setStudentName('');
    setIdNumber('');
    setCourse('');
  };

  const handleSubmit = () => {
    if (!studentName.trim() || !idNumber.trim() || !course.trim()) return;
    onVerified?.(studentName.trim(), idNumber.trim(), course.trim());
    handleClose();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Ionicons name="keypad" size={16} color="#1F2937" />
        <Text style={styles.buttonText}>Manual Entry</Text>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>Manual Entry</Text>
                <Text style={styles.subtitle}>Enter the student&apos;s information</Text>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={handleClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <Ionicons name="close" size={20} color="#374151" />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Student Name</Text>
            <TextInput
              value={studentName}
              onChangeText={setStudentName}
              placeholder="Enter student name"
              placeholderTextColor={Palette.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>ID Number</Text>
            <TextInput
              value={idNumber}
              onChangeText={setIdNumber}
              placeholder="e.g. 2026102934"
              placeholderTextColor={Palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="numeric"
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Course</Text>
            <TextInput
              value={course}
              onChangeText={setCourse}
              placeholder="e.g. BSCpE"
              placeholderTextColor={Palette.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />

            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
              <Text style={styles.submitButtonText}>Verify Student</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: 115,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: '#1F2937',
    fontSize: 12,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: Palette.textSecondary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Palette.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 15,
    color: Palette.text,
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: Palette.text,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});

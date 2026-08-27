import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

export type ScannerFeedbackTone = 'idle' | 'success' | 'warning' | 'error';

export interface ScannerVerificationPillProps {
  tone?: ScannerFeedbackTone;
  title?: string;
  detail?: string;
}

const TONE_STYLES: Record<Exclude<ScannerFeedbackTone, 'idle'>, { label: string; icon: 'checkmark-circle' | 'alert-circle' }> = {
  success: { label: 'Recorded', icon: 'checkmark-circle' },
  warning: { label: 'Review Required', icon: 'alert-circle' },
  error: { label: 'Scan Failed', icon: 'alert-circle' },
};

export function ScannerVerificationPill({
  tone = 'idle',
  title,
  detail,
}: ScannerVerificationPillProps) {
  if (tone === 'idle') return null;

  const palette =
    tone === 'success'
      ? { main: '#10B981', soft: '#D1FAE5', border: '#A7F3D0', text: '#059669' }
      : { main: '#EF4444', soft: '#FFE4E6', border: '#FECACA', text: '#E11D48' };
  const copy = TONE_STYLES[tone];

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: palette.soft, borderColor: palette.border },
      ]}>
      <View style={[styles.iconCircle, { backgroundColor: tone === 'success' ? palette.main : palette.main }]}>
        <Ionicons name={copy.icon} size={21} color={palette.main} />
      </View>

      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.text }]}>
          {title ?? copy.label}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    bottom: 175,
    alignSelf: 'center',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    maxWidth: '86%',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  copy: {
    marginRight: 8,
    flexShrink: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detail: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
});

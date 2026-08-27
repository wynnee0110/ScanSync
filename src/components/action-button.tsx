import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ActionButtonProps = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function ActionButton({
  label,
  variant = 'primary',
  disabled,
  style,
  ...props
}: ActionButtonProps) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: isDanger ? theme.danger : isPrimary ? theme.accent : theme.surface,
          borderColor: isDanger ? theme.danger : isPrimary ? theme.accent : theme.border,
          opacity: disabled ? 0.48 : 1,
        },
        pressed && !disabled && styles.pressed,
        style,
      ]}
      {...props}>
      <Text
        style={[
          styles.label,
          { color: isDanger ? '#FFFFFF' : isPrimary ? theme.accentContrast : theme.text },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.98 }] },
});

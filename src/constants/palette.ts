/**
 * Light palette used by the migrated prototype UI (home, profile, login, and
 * the floating tab bar). The original prototype used Tailwind utility colors,
 * which were refactored into this static StyleSheet palette during migration.
 * The pre-existing icpep-scansync feature components stay theme-aware via
 * `@/constants/theme` + `useTheme`.
 */

export const Palette = {
  background: '#F9FAFB', // gray-50
  surface: '#FFFFFF',
  text: '#111827', // gray-900
  textSecondary: '#6B7280', // gray-500
  textMuted: '#9CA3AF', // gray-400
  textFaint: '#D1D5DB', // gray-300
  border: '#E5E7EB', // gray-200
  borderLight: '#F3F4F6', // gray-100
  accent: '#111827',
  success: '#10B981', // emerald-500
  successSoft: '#D1FAE5', // emerald-100
  successText: '#059669', // emerald-600
  danger: '#EF4444', // rose-500
  dangerSoft: '#FFE4E6', // rose-100
  dangerText: '#E11D48', // rose-600
  amber: '#FBBF24',
} as const;

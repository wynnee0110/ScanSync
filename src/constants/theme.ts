/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#18201C',
    background: '#F5F8F6',
    backgroundElement: '#E8EFEA',
    backgroundSelected: '#D8E7DE',
    surface: '#FCFDFC',
    textSecondary: '#59665F',
    border: '#D3DDD6',
    accent: '#147A55',
    accentMuted: '#DCEFE5',
    accentContrast: '#F7FCF9',
    warning: '#9A6314',
    danger: '#B33D48',
  },
  dark: {
    text: '#EEF4F0',
    background: '#101512',
    backgroundElement: '#1A231E',
    backgroundSelected: '#24372D',
    surface: '#151C18',
    textSecondary: '#A7B4AC',
    border: '#2B3831',
    accent: '#58C694',
    accentMuted: '#183A2B',
    accentContrast: '#0D1A13',
    warning: '#E1A94F',
    danger: '#F07983',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 1040;

export const Radius = {
  small: 10,
  medium: 14,
  large: 18,
} as const;

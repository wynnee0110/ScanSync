import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastType = 'success' | 'offline' | 'error' | 'info';

export interface ToastMessage {
  id?: string;
  type: ToastType;
  title: string;
  message?: string;
}

export interface HotToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function HotToast({ toast, onDismiss }: HotToastProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [onDismiss, opacity, translateY]);

  useEffect(() => {
    if (toast) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        dismiss();
      }, 4000);

      return () => clearTimeout(timer);
    } else {
      translateY.setValue(-120);
      opacity.setValue(0);
    }
  }, [dismiss, opacity, toast, translateY]);

  if (!toast) return null;

  const getStyle = () => {
    switch (toast.type) {
      case 'success':
        return {
          bg: '#ECFDF5',
          border: '#6EE7B7',
          iconBg: '#10B981',
          iconName: 'checkmark-circle-outline' as const,
          titleColor: '#065F46',
          msgColor: '#047857',
        };
      case 'offline':
        return {
          bg: '#FFFBEB',
          border: '#FCD34D',
          iconBg: '#F59E0B',
          iconName: 'cloud-offline-outline' as const,
          titleColor: '#92400E',
          msgColor: '#B45309',
        };
      case 'error':
        return {
          bg: '#FEF2F2',
          border: '#FCA5A5',
          iconBg: '#EF4444',
          iconName: 'alert-circle-outline' as const,
          titleColor: '#991B1B',
          msgColor: '#B91C1C',
        };
      default:
        return {
          bg: '#F0F9FF',
          border: '#7DD3FC',
          iconBg: '#0284C7',
          iconName: 'information-circle-outline' as const,
          titleColor: '#075985',
          msgColor: '#0369A1',
        };
    }
  };

  const styleConfig = getStyle();

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          top: Math.max(insets.top + 10, 16),
          transform: [{ translateY }],
          opacity,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        onPress={dismiss}
        style={[
          styles.container,
          {
            backgroundColor: styleConfig.bg,
            borderColor: styleConfig.border,
          },
        ]}>
        <View style={[styles.iconCircle, { backgroundColor: styleConfig.iconBg }]}>
          <Ionicons name={styleConfig.iconName} size={20} color="#FFFFFF" />
        </View>

        <View style={styles.content}>
          <Text style={[styles.title, { color: styleConfig.titleColor }]}>{toast.title}</Text>
          {toast.message ? (
            <Text style={[styles.message, { color: styleConfig.msgColor }]}>{toast.message}</Text>
          ) : null}
        </View>

        <Pressable onPress={dismiss} hitSlop={8} style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={styleConfig.titleColor} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 9999,
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  message: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  closeBtn: {
    padding: 4,
  },
});

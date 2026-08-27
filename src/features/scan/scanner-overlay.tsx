import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const SCANNER_BOX_SIZE = 256;
export const SCANNER_CORNER_SIZE = 32;

export interface ScannerOverlayProps {
  torch?: boolean;
  onToggleTorch?: () => void;
  header?: React.ReactNode;
}

export function ScannerOverlay({
  torch = false,
  onToggleTorch,
  header,
}: ScannerOverlayProps) {
  const insets = useSafeAreaInsets();
  const scanAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [scanAnim]);

  const translateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCANNER_BOX_SIZE - 30],
  });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Dark Backdrop */}
      <View style={styles.mask} pointerEvents="none">
        <View style={styles.maskBlock} />

        <View style={styles.maskMiddle}>
          <View style={styles.maskBlock} />

          {/* Transparent Scanner Area */}
          <View style={styles.maskHole} />

          <View style={styles.maskBlock} />
        </View>

        <View style={styles.maskBlock} />
      </View>

      {/* Scanner */}
      <View style={styles.center} pointerEvents="none">
        <View style={styles.box}>
          {/* White Corner Brackets */}

          {/* Top Left */}
          <View style={[styles.corner, styles.topLeft]} />

          {/* Top Right */}
          <View style={[styles.corner, styles.topRight]} />

          {/* Bottom Left */}
          <View style={[styles.corner, styles.bottomLeft]} />

          {/* Bottom Right */}
          <View style={[styles.corner, styles.bottomRight]} />

          {/* Animated Scan Line */}
          <View style={styles.lineTrack}>
            <Animated.View
              style={[
                styles.scanLine,
                {
                  transform: [{ translateY }],
                },
              ]}
            />
          </View>
        </View>
      </View>

      {/* Top Controls */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
          },
        ]}
      >
        <View style={styles.topBarLeft}>{header}</View>

        <TouchableOpacity
          onPress={onToggleTorch}
          activeOpacity={0.7}
          style={[
            styles.torchButton,
            torch
              ? styles.torchButtonOn
              : styles.torchButtonOff,
          ]}
        >
          <Ionicons
            name={torch ? 'flash' : 'flash-off'}
            size={20}
            color={torch ? '#000000' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  /* =========================
     DARK BACKDROP
     ========================= */

  mask: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  maskBlock: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },

  maskMiddle: {
    height: SCANNER_BOX_SIZE,
    flexDirection: 'row',
  },

  maskHole: {
    width: SCANNER_BOX_SIZE,
    height: SCANNER_BOX_SIZE,
  },

  /* =========================
     SCANNER BOX
     ========================= */

  center: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,

    justifyContent: 'center',
    alignItems: 'center',
  },

  box: {
    width: SCANNER_BOX_SIZE,
    height: SCANNER_BOX_SIZE,

    // Full white outline
    borderWidth: 0.5,
    borderColor: '#FFFFFF',


    overflow: 'hidden',

    alignItems: 'center',
    justifyContent: 'center',
  },

  /* =========================
     WHITE CORNER BRACKETS
     ========================= */

  corner: {
    position: 'absolute',

    width: SCANNER_CORNER_SIZE,
    height: SCANNER_CORNER_SIZE,

    borderColor: '#FFFFFF',
    borderWidth: 4,

    zIndex: 10,
  },

  topLeft: {
    top: -2,
    left: -2,

    borderRightWidth: 0,
    borderBottomWidth: 0,


  },

  topRight: {
    top: -2,
    right: -2,

    borderLeftWidth: 0,
    borderBottomWidth: 0,


  },

  bottomLeft: {
    bottom: -2,
    left: -2,

    borderRightWidth: 0,
    borderTopWidth: 0,


  },

  bottomRight: {
    bottom: -2,
    right: -2,

    borderLeftWidth: 0,
    borderTopWidth: 0,

  },

  /* =========================
     SCAN LINE
     ========================= */

  lineTrack: {
    width: '100%',
    height: '100%',

    overflow: 'hidden',

    padding: 8,
  },

  scanLine: {
    width: '100%',
    height: 2,

    backgroundColor: '#FFFFFF',
  },

  /* =========================
     TOP BAR
     ========================= */

  topBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,

    paddingHorizontal: 24,

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',

    gap: 12,
  },

  topBarLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },

  /* =========================
     TORCH BUTTON
     ========================= */

  torchButton: {
    width: 44,
    height: 44,

    borderRadius: 22,

    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
  },

  torchButtonOn: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },

  torchButtonOff: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
});
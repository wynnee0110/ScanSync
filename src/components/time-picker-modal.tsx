import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';

// ─── Types ───────────────────────────────────────────────────────────────────

type TimePickerModalProps = {
  visible: boolean;
  /** 24-hour format string HH:MM */
  value: string;
  onSelect: (time24: string) => void;
  onClose: () => void;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses a time string (HH:MM or HH:MM AM/PM) into 12-hour clock format.
 * Returns numeric hour12 (1-12), minute (0-59), and isPm boolean indicator.
 */
function parseTime(timeStr: string) {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return { hour12: 9, minute: 0, isPm: false };

  let h = Number(match[1]);
  let m = Number(match[2]);
  const period = match[3]?.toUpperCase();

  if (period) {
    const isPm = period === 'PM';
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return { hour12, minute: m, isPm };
  } else {
    const isPm = h >= 12;
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return { hour12, minute: m, isPm };
  }
}

/** Formats numeric 12-hour parameters into a clean 'HH:MM AM/PM' string. */
function format12Hour(hour12: number, minute: number, isPm: boolean): string {
  const hStr = hour12.toString().padStart(2, '0');
  const mStr = minute.toString().padStart(2, '0');
  const period = isPm ? 'PM' : 'AM';
  return `${hStr}:${mStr} ${period}`;
}

// ─── Wheel Picker Component ──────────────────────────────────────────────────

type WheelPickerProps<T> = {
  data: T[];
  selectedIndex: number;
  onChange: (index: number) => void;
  renderItem: (item: T, selected: boolean) => React.ReactNode;
};

/**
 * WheelPicker — Drum-wheel scroll picker with snap-to-item mechanics.
 */
function WheelPicker<T>({
  data,
  selectedIndex,
  onChange,
  renderItem,
}: WheelPickerProps<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const sidePadding = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

  useEffect(() => {
    if (!scrollRef.current) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: selectedIndex * ITEM_HEIGHT,
        animated: false,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedIndex]);

  const handleScrollEnd = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const index = Math.round(offsetY / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(index, data.length - 1));
    onChange(clampedIndex);
  };

  return (
    <View style={styles.wheel}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        bounces={false}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        contentContainerStyle={{
          paddingVertical: sidePadding,
        }}>
        {data.map((item, index) => {
          const selected = index === selectedIndex;
          return (
            <Pressable
              key={index}
              onPress={() => {
                onChange(index);
                scrollRef.current?.scrollTo({
                  y: index * ITEM_HEIGHT,
                  animated: true,
                });
              }}
              style={styles.wheelItem}>
              {renderItem(item, selected)}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TimePickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: TimePickerModalProps) {
  const initial = parseTime(value);
  const [selectedHour, setSelectedHour] = useState(initial.hour12);
  const [selectedMinute, setSelectedMinute] = useState(initial.minute);
  const [isPm, setIsPm] = useState(initial.isPm);

  useEffect(() => {
    if (!visible) return;
    const parsed = parseTime(value);
    setSelectedHour(parsed.hour12);
    setSelectedMinute(parsed.minute);
    setIsPm(parsed.isPm);
  }, [visible, value]);

  const handleConfirm = useCallback(() => {
    onSelect(format12Hour(selectedHour, selectedMinute, isPm));
    onClose();
  }, [selectedHour, selectedMinute, isPm, onSelect, onClose]);

  const hourIndex = HOURS.indexOf(selectedHour);
  const periodIndex = isPm ? 1 : 0;
  const displayTime = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>

            <Text style={styles.headerTitle}>Select Time</Text>

            <Pressable
              onPress={handleConfirm}
              hitSlop={8}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>

          {/* Time Display Sub-header */}
          <View style={styles.previewContainer}>
            <Text style={styles.previewTimeText}>{displayTime}</Text>
          </View>

          {/* Wheel Picker Container */}
          <View style={styles.pickerContainer}>
            {/* Selection Highlight Band */}
            <View pointerEvents="none" style={styles.selectionHighlight} />

            <View style={styles.wheelsRow}>
              {/* Hour Wheel */}
              <WheelPicker
                data={HOURS}
                selectedIndex={hourIndex < 0 ? 0 : hourIndex}
                onChange={(index) => setSelectedHour(HOURS[index])}
                renderItem={(hour, selected) => (
                  <Text style={[styles.wheelText, selected && styles.wheelTextSelected]}>
                    {hour.toString().padStart(2, '0')}
                  </Text>
                )}
              />

              <Text style={styles.colonSeparator}>:</Text>

              {/* Minute Wheel */}
              <WheelPicker
                data={MINUTES}
                selectedIndex={selectedMinute}
                onChange={(index) => setSelectedMinute(index)}
                renderItem={(minute, selected) => (
                  <Text style={[styles.wheelText, selected && styles.wheelTextSelected]}>
                    {minute}
                  </Text>
                )}
              />

              {/* AM / PM Wheel */}
              <WheelPicker
                data={PERIODS}
                selectedIndex={periodIndex}
                onChange={(index) => setIsPm(index === 1)}
                renderItem={(period, selected) => (
                  <Text style={[styles.wheelText, selected && styles.wheelTextSelected]}>
                    {period}
                  </Text>
                )}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Fixed-Size Modern Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },

  modalCard: {
    width: 340,
    height: 350,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },

  headerBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.border,
  },

  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.3,
  },

  headerBtn: {
    paddingVertical: 4,
  },

  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: Palette.textSecondary,
  },

  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },

  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: Palette.background,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },

  previewTimeText: {
    fontSize: 17,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.2,
  },

  pickerContainer: {
    height: WHEEL_HEIGHT,
    position: 'relative',
    marginHorizontal: 16,
  },

  selectionHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderRadius: 10,
    backgroundColor: Palette.borderLight,
  },

  wheelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WHEEL_HEIGHT,
  },

  wheel: {
    flex: 1,
    height: WHEEL_HEIGHT,
    overflow: 'hidden',
  },

  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  colonSeparator: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
    marginHorizontal: 2,
  },

  wheelText: {
    fontSize: 17,
    fontWeight: '400',
    color: Palette.textSecondary,
  },

  wheelTextSelected: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
  },

  pressed: {
    opacity: 0.5,
  },
});

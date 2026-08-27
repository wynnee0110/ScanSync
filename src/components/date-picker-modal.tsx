import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';

// ─── Types ───────────────────────────────────────────────────────────────────

type DatePickerModalProps = {
  visible: boolean;
  /** ISO date string YYYY-MM-DD */
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Parses an ISO date string (YYYY-MM-DD) into numeric year, month, and day components.
 * Falls back to current date values if parsing fails or values are out of bounds.
 */
function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const parts = iso.split('-').map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  const today = new Date();
  return {
    year: (y && y > 1900 && y < 2200) ? y : today.getFullYear(),
    month: (mo && mo >= 1 && mo <= 12) ? mo : today.getMonth() + 1,
    day: (d && d >= 1 && d <= 31) ? d : today.getDate(),
  };
}

/** Formats year, month, and day numbers into a YYYY-MM-DD ISO string. */
function toIso(year: number, month: number, day: number): string {
  return [
    year.toString(),
    month.toString().padStart(2, '0'),
    day.toString().padStart(2, '0'),
  ].join('-');
}

/** Calculates total days in a specified year and month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Returns day-of-week index (0 = Sunday) for the 1st day of a month. */
function firstWeekdayOf(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** Returns current date as a YYYY-MM-DD ISO string. */
function isoToday(): string {
  const t = new Date();
  return toIso(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** Formats date into a human-readable display string (e.g. "Wed, Aug 15, 2026"). */
function formatDisplayDate(year: number, month: number, day: number): string {
  const dateObj = new Date(year, month - 1, day);
  return dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * DatePickerModal — Apple-inspired minimal custom calendar date picker.
 *
 * Features:
 * - Fixed 340x480 card dimensions to eliminate vertical layout jumps.
 * - 42-cell uniform 6-row grid layout with month navigation.
 * - 36x36px perfect circle day selection badges.
 */
export function DatePickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: DatePickerModalProps) {
  const parsed = useMemo(() => parseIsoDate(value), [value]);

  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);
  const [selectedDay, setSelectedDay] = useState(parsed.day);

  const selectedIso = useMemo(
    () => toIso(viewYear, viewMonth, selectedDay),
    [viewYear, viewMonth, selectedDay],
  );

  const todayIso = useMemo(() => isoToday(), []);

  // Fixed 42 cells (6 rows x 7 days) ensures identical height across all months
  const gridDays = useMemo<(number | null)[]>(() => {
    const total = daysInMonth(viewYear, viewMonth);
    const offset = firstWeekdayOf(viewYear, viewMonth);
    const cells: (number | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= total; d++) cells.push(d);
    while (cells.length < 42) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 1) { setViewYear((y) => y - 1); return 12; }
      return m - 1;
    });
    setSelectedDay(1);
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 12) { setViewYear((y) => y + 1); return 1; }
      return m + 1;
    });
    setSelectedDay(1);
  }, []);

  const handleDayPress = useCallback((day: number) => {
    setSelectedDay(day);
  }, []);

  const handleConfirm = useCallback(() => {
    onSelect(toIso(viewYear, viewMonth, selectedDay));
    onClose();
  }, [viewYear, viewMonth, selectedDay, onSelect, onClose]);

  const displayDateText = useMemo(
    () => formatDisplayDate(viewYear, viewMonth, selectedDay),
    [viewYear, viewMonth, selectedDay],
  );

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          {/* Android Material Header Banner */}
          <View style={styles.materialHeader}>
            <Text style={styles.materialHeaderLabel}>SELECT DATE</Text>
            <Text style={styles.materialHeaderValue}>{displayDateText}</Text>
          </View>

          {/* Month Navigation */}
          <View style={styles.monthNavRow}>
            <Text style={styles.monthTitle}>
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </Text>

            <View style={styles.navButtonsGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={prevMonth}
                style={({ pressed }) => [styles.navArrowBtn, pressed && styles.pressed]}>
                <Ionicons name="chevron-back" size={18} color={Palette.text} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={nextMonth}
                style={({ pressed }) => [styles.navArrowBtn, pressed && styles.pressed]}>
                <Ionicons name="chevron-forward" size={18} color={Palette.text} />
              </Pressable>
            </View>
          </View>

          {/* Day of Week Labels */}
          <View style={styles.weekHeaderRow}>
            {DAY_LABELS.map((label, i) => (
              <Text key={`${label}-${i}`} style={styles.weekHeaderCell}>
                {label}
              </Text>
            ))}
          </View>

          {/* Fixed Height Calendar Day Grid */}
          <View style={styles.grid}>
            {gridDays.map((day, idx) => {
              if (day === null) {
                return <View key={`empty-${idx}`} style={styles.dayCell} />;
              }

              const cellIso = toIso(viewYear, viewMonth, day);
              const isSelected = cellIso === selectedIso;
              const isToday = cellIso === todayIso;

              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => handleDayPress(day)}
                  style={({ pressed }) => [
                    styles.dayCell,
                    pressed && styles.pressed,
                  ]}>
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && !isSelected && styles.dayCircleToday,
                      isSelected && styles.dayCircleSelected,
                    ]}>
                    <Text
                      style={[
                        styles.dayText,
                        isToday && !isSelected && styles.dayTextToday,
                        isSelected && styles.dayTextSelected,
                      ]}>
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Android Material Dialog Action Buttons (CANCEL / OK) */}
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
              <Text style={styles.actionButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleConfirm}
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
              <Text style={[styles.actionButtonText, styles.actionButtonPrimary]}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Fixed-Size Android Material Styles ────────────────────────────────────────

const CELL_SIZE = 38;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },

  modalCard: {
    width: 330,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 12,
  },

  materialHeader: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 18,
  },

  materialHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.2,
    marginBottom: 4,
  },

  materialHeaderValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 6,
  },

  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.2,
  },

  navButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  navArrowBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Palette.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  weekHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 4,
  },

  weekHeaderCell: {
    width: CELL_SIZE,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textMuted,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    rowGap: 2,
    height: CELL_SIZE * 6 + 12,
  },

  dayCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: '#0284C7',
    borderRadius: 18,
  },

  dayCircleSelected: {
    backgroundColor: '#0284C7',
    borderRadius: 18,
  },

  dayText: {
    fontSize: 14,
    fontWeight: '500',
    color: Palette.text,
  },

  dayTextToday: {
    color: '#0284C7',
    fontWeight: '700',
  },

  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.borderLight,
  },

  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },

  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.textSecondary,
    letterSpacing: 0.5,
  },

  actionButtonPrimary: {
    color: '#0284C7',
  },

  pressed: {
    opacity: 0.5,
  },
});

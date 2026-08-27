import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { listAttendanceHistory, listEvents } from '@/features/events/event-repository';
import type { AttendanceHistoryItem, LocalEvent } from '@/features/events/event-types';
import { HistorySection } from '@/features/attendance/history-section';

export function HistoryScreen() {
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [events, setEvents] = useState<LocalEvent[]>([]);

  const reload = useCallback(async () => {
    try {
      const [nextHistory, nextEvents] = await Promise.all([
        listAttendanceHistory(100),
        listEvents(),
      ]);
      setHistory(nextHistory);
      setEvents(nextEvents);
    } catch {
      // Keep previous data if reload fails
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Attendance History</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <HistorySection
          items={history}
          events={events}
          onChanged={() => void reload()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  headerBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
    backgroundColor: Palette.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  pressed: {
    opacity: 0.7,
  },
});

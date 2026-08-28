import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HotToast, type ToastMessage } from '@/components/hot-toast';
import { Palette } from '@/constants/palette';
import { HistorySection } from '@/features/attendance/history-section';
import { getPendingSyncCount, listAttendanceHistory, listEvents } from '@/features/events/event-repository';
import type { AttendanceHistoryItem, LocalEvent } from '@/features/events/event-types';
import { processSyncQueue } from '@/lib/sync-worker';

export function HistoryScreen() {
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextHistory, nextEvents, nextPendingCount] = await Promise.all([
        listAttendanceHistory(100),
        listEvents(),
        getPendingSyncCount(),
      ]);
      setHistory(nextHistory);
      setEvents(nextEvents);
      setPendingSyncCount(nextPendingCount);
    } catch {
      // Keep previous data if reload fails
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await processSyncQueue();
      setToast({
        type: 'success',
        title: 'Sync Complete',
        message: `Synced attendance history with cloud (${res.successCount} local records processed).`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync encountered an issue.';
      if (message.includes('offline') || message.includes('Cannot sync offline')) {
        setToast({
          type: 'offline',
          title: 'Cannot Sync Offline',
          message: 'Connect to Wi-Fi or mobile data to sync attendance data.',
        });
      } else if (message.includes('revoked')) {
        setToast({
          type: 'error',
          title: 'Access Revoked',
          message: 'Operator access has been revoked.',
        });
      } else {
        setToast({
          type: 'error',
          title: 'Sync Notice',
          message,
        });
      }
    } finally {
      setSyncing(false);
      void reload();
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <HotToast toast={toast} onDismiss={() => setToast(null)} />
      <View style={styles.headerBar}>
        <View style={styles.headerTitleGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Attendance History</Text>
        </View>

        {/* SYNC BUTTON (ACCESSIBLE TO VOLUNTEERS & ALL ROLES) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sync attendance history to cloud"
          disabled={syncing}
          onPress={handleSync}
          style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}>
          <View>
            <Ionicons
              name={syncing ? 'sync' : 'cloud-upload-outline'}
              size={20}
              color={pendingSyncCount > 0 ? Palette.successText : Palette.text}
            />
            {pendingSyncCount > 0 && !syncing && (
              <View style={styles.syncBadge}>
                <Text style={styles.syncBadgeText}>
                  {pendingSyncCount > 99 ? '99+' : pendingSyncCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
    backgroundColor: Palette.surface,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
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
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  syncBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: Palette.danger,
    borderRadius: 9,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  pressed: {
    opacity: 0.7,
  },
});

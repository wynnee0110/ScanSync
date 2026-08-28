import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useMemo, useCallback, useState, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import {
  getDashboardStats,
  getTodayAttendanceCountForEvent,
  listEvents,
} from '@/features/events/event-repository';
import type { DashboardStats, LocalEvent } from '@/features/events/event-types';

import { getOperators, subscribeOperators } from '@/features/operators/operator-store';
import type { OperatorItem } from '@/features/operators/operator-types';
import { HomeHeader } from '@/features/home/home-header';
import { QuickStats } from '@/features/home/quick-stats';
import { ScannerStatusCard } from '@/features/home/scanner-status-card';
import { getPreference, SELECTED_EVENT_KEY, setPreference } from '@/lib/preferences';

const EMPTY_STATS: DashboardStats = {
  totalAttendees: 0,
  todayAttendees: 0,
  totalEvents: 0,
  activeEvents: 0,
  pendingSync: 0,
  yearLevelCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
  unknownYearCount: 0,
};

export function HomeScreen() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [storedSelectedEventId, setStoredSelectedEventId] = useState<string | null>(null);
  const [selectedTodayCount, setSelectedTodayCount] = useState(0);
  const [operators, setOperatorsState] = useState<OperatorItem[]>(() => getOperators());

  useEffect(() => {
    const unsub = subscribeOperators(() => {
      setOperatorsState(getOperators());
    });
    return unsub;
  }, []);

  const reload = useCallback(async () => {
    try {
      const [nextStats, nextEvents, storedEventId] = await Promise.all([
        getDashboardStats(),
        listEvents(),
        getPreference(SELECTED_EVENT_KEY).catch(() => null),
      ]);
      setStats(nextStats);
      setEvents(nextEvents);
      setStoredSelectedEventId(storedEventId);
      const resolved =
        nextEvents.find((event) => event.id === storedEventId) ??
        nextEvents.find((event) => event.status === 'active') ??
        null;
      if (resolved) {
        const today = await getTodayAttendanceCountForEvent(resolved.id);
        setSelectedTodayCount(today);
      } else {
        setSelectedTodayCount(0);
      }
    } catch {
      // Keep the last known values so the home shell never goes blank.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const { user, localUser, role: userRole, assignedEventId } = useAuth();
  const userEmail = (localUser?.email || user?.email || '').toLowerCase();

  const scopedEvents = useMemo(() => {
    if (userRole === 'Superadmin') {
      return events;
    }
    if (userRole === 'Organizer') {
      return events.filter(
        (e) =>
          (e.createdBy && e.createdBy.toLowerCase() === userEmail) ||
          e.id === assignedEventId,
      );
    }
    if (userRole === 'Volunteer') {
      return events.filter((e) => e.id === assignedEventId);
    }
    return events;
  }, [events, userRole, userEmail, assignedEventId]);

  const scopedEventIds = useMemo(() => new Set(scopedEvents.map((e) => e.id)), [scopedEvents]);

  const scopedStats = useMemo(() => {
    if (userRole === 'Superadmin') {
      return stats;
    }
    const totalAttendees = scopedEvents.reduce((sum, e) => sum + e.attendeeCount, 0);
    return {
      ...stats,
      totalAttendees,
      totalEvents: scopedEvents.length,
      activeEvents: scopedEvents.filter((e) => e.status === 'active').length,
    };
  }, [userRole, scopedEvents, stats]);

  const operatorBadgeText = useMemo(() => {
    if (userRole === 'Superadmin') {
      const count = operators.length;
      return `${count} ${count === 1 ? 'operator' : 'operators'}`;
    }
    if (userRole === 'Organizer') {
      const managedVolunteers = operators.filter(
        (op) =>
          op.role === 'Volunteer' &&
          ((op.createdBy && op.createdBy.toLowerCase() === userEmail) ||
            (op.assignedEventId && scopedEventIds.has(op.assignedEventId))),
      );
      const count = managedVolunteers.length;
      return `${count} ${count === 1 ? 'volunteer' : 'volunteers'}`;
    }
    return 'Active';
  }, [userRole, operators, userEmail, scopedEventIds]);

  const selectedEvent =
    scopedEvents.find((event) => event.id === storedSelectedEventId) ??
    scopedEvents.find((event) => event.status === 'active') ??
    null;

  const activeEvents = scopedEvents.filter((event) => event.status === 'active');

  const handleSelectEvent = useCallback((eventId: string) => {
    setStoredSelectedEventId(eventId);
    void setPreference(SELECTED_EVENT_KEY, eventId);
    void getTodayAttendanceCountForEvent(eventId)
      .then(setSelectedTodayCount)
      .catch(() => setSelectedTodayCount(0));
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <HomeHeader />

        <ScannerStatusCard
          event={selectedEvent}
          events={activeEvents}
          todayCount={selectedTodayCount}
          onSelectEvent={handleSelectEvent}
        />

        {/* HERO SCAN BUTTON */}
        <View style={styles.heroSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open QR Scanner"
            onPress={() => router.push('/scan')}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            style={({ pressed }) => [styles.scanHeroBtn, pressed && styles.pressedHero]}>
            <View style={styles.scanHeroIconBox}>
              <Ionicons name="qr-code" size={24} color="#111827" />
            </View>
            <View style={styles.scanHeroContent}>
              <Text style={styles.scanHeroTitle}>Scan Attendance</Text>
              <Text style={styles.scanHeroSubtitle}>Tap to launch camera scanner</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <QuickStats
          scans={scopedStats.totalAttendees}
          today={selectedTodayCount > 0 ? selectedTodayCount : scopedStats.todayAttendees}
          pending={scopedStats.pendingSync}
        />

        {/* NAVIGATION BUTTONS */}
        <View style={styles.navSection}>
          <View style={styles.navHeaderRow}>
            <Text style={styles.navSectionTitle}>Management & History</Text>
          </View>

          {userRole !== 'Volunteer' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Events page"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => router.push('/events')}
              android_ripple={{ color: 'rgba(0, 0, 0, 0.05)' }}
              style={({ pressed }) => [styles.navCard, pressed && styles.pressed]}>
              <View style={[styles.navIconBox, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="calendar" size={24} color="#0284C7" />
              </View>
              <View style={styles.navContent}>
                <View style={styles.navTitleRow}>
                  <Text style={styles.navTitle}>Events</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {scopedEvents.length} {scopedEvents.length === 1 ? 'event' : 'events'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.navSubtitle}>View, select, and create events</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Palette.textSecondary} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Attendance History page"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => router.push('/history')}
            android_ripple={{ color: 'rgba(0, 0, 0, 0.05)' }}
            style={({ pressed }) => [styles.navCard, pressed && styles.pressed]}>
            <View style={[styles.navIconBox, { backgroundColor: Palette.successSoft }]}>
              <Ionicons name="time" size={24} color={Palette.successText} />
            </View>
            <View style={styles.navContent}>
              <View style={styles.navTitleRow}>
                <Text style={styles.navTitle}>Attendance History</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {scopedStats.totalAttendees} {scopedStats.totalAttendees === 1 ? 'record' : 'records'}
                  </Text>
                </View>
              </View>
              <Text style={styles.navSubtitle}>View, filter, edit, and delete scan records</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Palette.textSecondary} />
          </Pressable>

          {userRole !== 'Volunteer' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Operators Dashboard"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => router.push('/operators' as Href)}
              android_ripple={{ color: 'rgba(0, 0, 0, 0.05)' }}
              style={({ pressed }) => [styles.navCard, pressed && styles.pressed]}>
              <View style={[styles.navIconBox, { backgroundColor: '#F3E8FF' }]}>
                <Ionicons name="people" size={24} color="#7E22CE" />
              </View>
              <View style={styles.navContent}>
                <View style={styles.navTitleRow}>
                  <Text style={styles.navTitle}>Operators Dashboard</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{operatorBadgeText}</Text>
                  </View>
                </View>
                <Text style={styles.navSubtitle}>View active scanners, staff roles, and operator status</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Palette.textSecondary} />
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  heroSection: {
    marginHorizontal: 24,
    marginTop: 16,
  },
  scanHeroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.text,
    borderRadius: 20,
    padding: 16,
    gap: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  scanHeroIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanHeroContent: {
    flex: 1,
    gap: 2,
  },
  scanHeroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scanHeroSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  pressedHero: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  navSection: {
    marginHorizontal: 24,
    marginTop: 24,
    gap: 12,
  },
  navHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  navSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },

  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  navIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navContent: {
    flex: 1,
    gap: 2,
  },
  navTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  badge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  navSubtitle: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.99 }],
  },
});

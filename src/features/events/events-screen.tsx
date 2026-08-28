import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import { listEvents } from '@/features/events/event-repository';
import type { LocalEvent } from '@/features/events/event-types';
import { EventsSection } from '@/features/events/events-section';
import { processSyncQueue } from '@/lib/sync-worker';

export function EventsScreen() {
  const { role: userRole } = useAuth();
  const isVolunteer = userRole === 'Volunteer';
  const [events, setEvents] = useState<LocalEvent[]>([]);

  useEffect(() => {
    if (isVolunteer) {
      Alert.alert('Access Restricted', 'Volunteers do not have permission to view event management.');
      router.replace('/scan');
    }
  }, [isVolunteer]);

  const reload = useCallback(async () => {
    try {
      const data = await listEvents();
      setEvents(data);

      void processSyncQueue()
        .then(async () => {
          const refreshed = await listEvents();
          setEvents(refreshed);
        })
        .catch(() => {});
    } catch {
      // Keep previous events if fetch fails
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isVolunteer) return;
      void reload();
    }, [isVolunteer, reload]),
  );

  if (isVolunteer) {
    return null;
  }

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
        <Text style={styles.headerTitle}>Events</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <EventsSection events={events} onEventCreated={() => void reload()} />
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

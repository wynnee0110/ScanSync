import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { LocalEvent } from '@/features/events/event-types';
import { formatEventTimeRange } from '@/features/events/formatters';
import { useNetworkStatus } from '@/lib/use-network-status';

type ScannerStatusCardProps = {
  event: LocalEvent | null;
  events: LocalEvent[];
  todayCount: number;
  onSelectEvent: (eventId: string) => void;
};

export function ScannerStatusCard({
  event,
  events = [],
  todayCount,
  onSelectEvent,
}: ScannerStatusCardProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const networkStatus = useNetworkStatus();

  const handleSelect = useCallback(
    (eventId: string) => {
      setSelectorOpen(false);
      onSelectEvent(eventId);
    },
    [onSelectEvent],
  );

  const progress =
    event && event.expectedAttendees > 0
      ? Math.min(100, Math.round((event.attendeeCount / event.expectedAttendees) * 100))
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.onlineRow}>
          <View
            style={[
              styles.dot,
              !networkStatus.isConnected && styles.offlineDot,
            ]}
          />
          <Text
            style={[
              styles.onlineText,
              !networkStatus.isConnected && styles.offlineText,
            ]}>
            {networkStatus.label}
          </Text>
        </View>
      </View>

      {event ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change selected event, currently ${event.name}`}
            disabled={events.length === 0}
            onPress={() => setSelectorOpen(true)}
            style={({ pressed }) => [
              styles.eventSelectorRow,
              events.length > 0 && styles.eventSelectorRowPressable,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.eventName} numberOfLines={1}>
              {event.name}
            </Text>
            {events.length > 0 && (
              <View style={styles.eventSelectorMeta}>
                <Text style={styles.eventSelectorLabel}>SELECTED</Text>
                <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
              </View>
            )}
          </Pressable>

          <View style={styles.infoRows}>
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={14} color="#9CA3AF" />
              <Text style={styles.infoText} numberOfLines={1}>
                {event.venue}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={14} color="#9CA3AF" />
              <Text style={styles.infoText} numberOfLines={1}>
                {formatEventTimeRange(event.startsAt, event.endsAt)}
              </Text>
            </View>

          </View>

          <View style={styles.divider} />

          <View style={styles.valueRow}>
            <Text style={styles.value}>{todayCount}</Text>
            <Text style={styles.valueLabel}>checked in today</Text>
          </View>

          {progress !== null && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress}%` }]} />
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={styles.eventName}>No active event</Text>
          <Text style={styles.emptyDetail}>
            Create an active event to start capturing attendance.
          </Text>
        </>
      )}

      <Modal
        animationType="slide"
        transparent
        visible={selectorOpen}
        onRequestClose={() => setSelectorOpen(false)}>
        <Pressable
          style={styles.selectorBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close event selector"
          onPress={() => setSelectorOpen(false)}>
          <View style={styles.selectorSheet}>
            <View style={styles.selectorHandle} />
            <Text style={styles.selectorTitle}>Select Event</Text>
            <Text style={styles.selectorSubtitle}>Choose which active event to monitor and scan</Text>

            <ScrollView
              style={styles.selectorScroll}
              showsVerticalScrollIndicator={false}
              bounces={false}>
              {events.map((item) => {
                const isSelected = item.id === event?.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleSelect(item.id)}
                    style={({ pressed }) => [
                      styles.selectorCard,
                      isSelected && styles.selectorCardSelected,
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.selectorCardDot} />
                    <View style={styles.selectorCardBody}>
                      <Text style={styles.selectorCardName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.selectorCardMeta} numberOfLines={1}>
                        {item.venue} · {item.attendeeCount} checked in
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color="#111827" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 24,
    borderRadius: 24,
    backgroundColor: '#111827',
    padding: 20,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#34D399',
  },
  offlineDot: {
    backgroundColor: '#EF4444',
  },
  onlineText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  offlineText: {
    color: '#F87171',
  },
  eventSelectorRow: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventSelectorRowPressable: {
    paddingBottom: 4,
  },
  eventSelectorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventSelectorLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#9CA3AF',
  },
  eventName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  infoRows: {
    marginTop: 12,
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    flex: 0,
    fontSize: 13,
    color: '#D1D5DB',

  },
  divider: {
    marginTop: 16,
    height: 1,
    backgroundColor: '#1F2937',
  },
  valueRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  value: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  valueLabel: {
    marginLeft: 8,
    marginBottom: 6,
    fontSize: 13,
    color: '#9CA3AF',
  },
  track: {
    marginTop: 16,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#374151',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  emptyDetail: {
    marginTop: 8,
    fontSize: 13,
    color: '#9CA3AF',
  },
  pressed: {
    opacity: 0.7,
  },
  selectorBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  selectorSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '75%',
  },
  selectorHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    marginBottom: 16,
  },
  selectorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  selectorSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
  },
  selectorScroll: {
    flexGrow: 0,
  },
  selectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    backgroundColor: '#F9FAFB',
    marginBottom: 10,
  },
  selectorCardSelected: {
    borderColor: '#111827',
    backgroundColor: '#F0F0F0',
  },
  selectorCardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#34D399',
    flexShrink: 0,
  },
  selectorCardBody: {
    flex: 1,
    gap: 2,
  },
  selectorCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  selectorCardMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
});
import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';
import type { LocalEvent } from '@/features/events/event-types';
import { getOperatorAccessStatus } from '@/features/operators/operator-helpers';
import type { OperatorItem } from '@/features/operators/operator-types';

type OperatorCardProps = {
  operator: OperatorItem;
  events: LocalEvent[];
  canDelete?: boolean;
  onDelete: (id: string, name: string) => void;
};

export function OperatorCard({
  operator,
  events,
  canDelete = false,
  onDelete,
}: OperatorCardProps) {
  const access = getOperatorAccessStatus(operator, events);

  const handleCardPress = () => {
    router.push(`/users/${operator.id}` as Href);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View profile and activity for ${operator.name}`}
      onPress={handleCardPress}
      android_ripple={{ color: 'rgba(0, 0, 0, 0.05)' }}
      style={({ pressed }) => [styles.operatorCard, pressed && styles.pressed]}>
      <View style={styles.operatorHeaderRow}>
        <View style={styles.operatorMainInfo}>
          <View style={styles.avatarBox}>
            <Ionicons name="person" size={20} color={Palette.accent} />
          </View>
          <View style={styles.nameContainer}>
            <Text style={styles.operatorName}>{operator.name}</Text>
            <Text style={styles.operatorEmail}>{operator.email}</Text>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: access.bgColor }]}>
          <Text style={[styles.statusText, { color: access.color }]}>
            {access.label}
          </Text>
        </View>
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.detailsGrid}>
        <View style={styles.detailRow}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Palette.textSecondary} />
          <Text style={styles.detailLabel}>Role:</Text>
          <Text style={styles.detailValue}>{operator.role}</Text>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="mail-outline" size={14} color={Palette.textSecondary} />
          <Text style={styles.detailLabel}>Access Email:</Text>
          <Text style={[styles.detailValue, { fontWeight: '600' }]} numberOfLines={1}>
            {operator.email || 'No Email Registered'}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="key-outline" size={14} color={Palette.accent} />
          <Text style={styles.detailLabel}>Access Password / Code:</Text>
          <Text style={[styles.detailValue, { color: Palette.accent, fontWeight: '700' }]}>
            {operator.generatedPasswordCode}
          </Text>
        </View>


        <View style={styles.detailRow}>
          <Ionicons name="calendar-outline" size={14} color={Palette.textSecondary} />
          <Text style={styles.detailLabel}>Access Event:</Text>
          <Text
            style={[
              styles.detailValue,
              operator.role === 'Volunteer' && !operator.assignedEventId && { color: Palette.danger },
            ]}
            numberOfLines={1}>
            {(() => {
              if (operator.role === 'Superadmin') return 'All Events (Superadmin)';
              if (operator.role === 'Organizer') {
                return operator.assignedEventName && operator.assignedEventName !== 'Assigned Event'
                  ? operator.assignedEventName
                  : 'All Created Events (Organizer)';
              }
              const matchedEvent = events.find((e) => e.id === operator.assignedEventId);
              if (matchedEvent) return matchedEvent.name;
              if (operator.assignedEventName && operator.assignedEventName !== 'Assigned Event') {
                return operator.assignedEventName;
              }
              return 'No Event Assigned (Pending Assignment)';
            })()}
          </Text>
        </View>
      </View>

      {/* Card Footer Actions */}
      <View style={styles.cardFooter}>
        <Text style={styles.scanCountText}>{operator.scansCount} scans recorded</Text>
        {canDelete && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove operator ${operator.name}`}
            hitSlop={6}
            onPress={(e) => {
              e.stopPropagation();
              onDelete(operator.id, operator.name);
            }}
            style={styles.removeBtn}>
            <Ionicons name="trash-outline" size={14} color={Palette.danger} />
            <Text style={styles.removeBtnText}>Remove</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  operatorCard: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    gap: 12,
  },
  operatorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  operatorMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatarBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  nameContainer: {
    flex: 1,
  },
  operatorName: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  operatorEmail: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  cardDivider: {
    height: 1,
    backgroundColor: Palette.borderLight,
  },
  detailsGrid: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.text,
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  scanCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.danger,
  },
});

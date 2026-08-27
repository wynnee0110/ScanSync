import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';

type OperatorsStatsCardProps = {
  totalStaff: number;
  activeAccess: number;
  totalScans: number;
};

export function OperatorsStatsCard({
  totalStaff,
  activeAccess,
  totalScans,
}: OperatorsStatsCardProps) {
  return (
    <View style={styles.statsCard}>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalStaff}</Text>
          <Text style={styles.statLabel}>Total Staff</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: Palette.successText }]}>
            {activeAccess}
          </Text>
          <Text style={styles.statLabel}>Active Access</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: Palette.accent }]}>
            {totalScans}
          </Text>
          <Text style={styles.statLabel}>Total Scans</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statsCard: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Palette.text,
  },
  statLabel: {
    fontSize: 11,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: Palette.borderLight,
  },
});

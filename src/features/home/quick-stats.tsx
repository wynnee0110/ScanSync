import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';

type QuickStatsProps = {
  scans: number;
  today: number;
  pending: number;
};

function StatCard({ value, label, valueColor }: { value: number; label: string; valueColor: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: valueColor }]}>{value.toLocaleString()}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function QuickStats({ scans, today, pending }: QuickStatsProps) {
  return (
    <View style={styles.row}>
      <StatCard value={scans} label="Scans" valueColor={Palette.text} />
      <StatCard value={today} label="Today" valueColor={Palette.successText} />
      <StatCard value={pending} label="Pending" valueColor={Palette.danger} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 24,
    marginTop: 24,
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    padding: 16,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
  },
  label: {
    marginTop: 4,
    fontSize: 12,
    color: Palette.textSecondary,
  },
});

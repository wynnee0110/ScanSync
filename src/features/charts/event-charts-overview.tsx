import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import {
  BarChart,
  LineChart,
  PieChart,
  ProgressChart,
} from 'react-native-chart-kit';

import { Palette } from '@/constants/palette';
import type { AttendanceHistoryItem, LocalEvent } from '@/features/events/event-types';

type EventChartsOverviewProps = {
  event: LocalEvent;
  history: AttendanceHistoryItem[];
};

// ─── Screen width helper ────────────────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 64; // account for padding

// ─── Color constants ─────────────────────────────────────────────────────────
const C = {
  yr1: '#10B981',
  yr2: '#06B6D4',
  yr3: '#3B82F6',
  yr4: '#8B5CF6',
  unknown: '#9CA3AF',
  qr: '#111827',
  manual: '#FBBF24',
  synced: '#059669',
  pending: '#F59E0B',
} as const;

// ─── chartConfig defaults ─────────────────────────────────────────────────────
const baseConfig = {
  backgroundGradientFrom: '#FFFFFF',
  backgroundGradientTo: '#FFFFFF',
  color: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: Palette.accent,
  },
  propsForBackgroundLines: {
    stroke: '#F3F4F6',
    strokeDasharray: '',
  },
  decimalPlaces: 0,
};

// ─── Shared section wrapper ───────────────────────────────────────────────────
function ChartSection({
  icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.titleRow}>
          <View style={styles.iconCircle}>
            <Ionicons name={icon} size={14} color={Palette.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          </View>
        </View>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.chartCard}>{children}</View>
    </View>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string | number }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

// ─── 1. Peak Scan Times – Bar Chart ─────────────────────────────────────────
function ScanTimesChart({ history }: { history: AttendanceHistoryItem[] }) {
  const { labels, counts, peakLabel, peakCount } = useMemo(() => {
    const hourCounts: Record<number, number> = {};
    let lo = 23, hi = 0;
    for (const item of history) {
      const h = new Date(item.recordedAt).getHours();
      if (isNaN(h)) continue;
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    if (hi - lo < 3) hi = Math.min(23, lo + 3);

    let maxC = 0, peakH = lo;
    for (let h = lo; h <= hi; h++) {
      const c = hourCounts[h] ?? 0;
      if (c > maxC) { maxC = c; peakH = h; }
    }

    const labels: string[] = [];
    const counts: number[] = [];
    for (let h = lo; h <= hi; h++) {
      const h12 = h % 12 || 12;
      labels.push(`${h12}${h >= 12 ? 'P' : 'A'}`);
      counts.push(hourCounts[h] ?? 0);
    }

    const peakH12 = peakH % 12 || 12;
    return {
      labels,
      counts,
      maxCount: maxC,
      peakLabel: `${peakH12}${peakH >= 12 ? 'PM' : 'AM'}`,
      peakCount: maxC,
    };
  }, [history]);

  if (history.length === 0 || counts.every((c) => c === 0)) {
    return (
      <ChartSection icon="trending-up-outline" title="Peak Scan Times" subtitle="Hourly check-in volume">
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={22} color={Palette.textMuted} />
          <Text style={styles.emptyText}>No scan data yet</Text>
        </View>
      </ChartSection>
    );
  }

  return (
    <ChartSection
      icon="trending-up-outline"
      title="Peak Scan Times"
      subtitle="Hourly check-in volume"
      badge={`Peak: ${peakLabel} (${peakCount})`}>
      <BarChart
        data={{ labels, datasets: [{ data: counts }] }}
        width={CHART_W}
        height={180}
        chartConfig={{
          ...baseConfig,
          color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`,
          fillShadowGradient: '#10B981',
          fillShadowGradientOpacity: 1,
        }}
        style={styles.chart}
        fromZero
        showValuesOnTopOfBars
        withInnerLines={false}
        yAxisLabel=""
        yAxisSuffix=""
      />
    </ChartSection>
  );
}

// ─── 2. Cumulative Attendance – Line Chart ───────────────────────────────────
function CumulativeAttendanceChart({ history }: { history: AttendanceHistoryItem[] }) {
  const { labels, data } = useMemo(() => {
    if (history.length < 2) return { labels: [], data: [] };

    const sorted = [...history]
      .filter((h) => !isNaN(new Date(h.recordedAt).getTime()))
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    // Bucket into at most 8 time slots for readability
    const step = Math.max(1, Math.ceil(sorted.length / 8));
    const labels: string[] = [];
    const data: number[] = [];
    let count = 0;

    sorted.forEach((item, i) => {
      count++;
      if ((i + 1) % step === 0 || i === sorted.length - 1) {
        const d = new Date(item.recordedAt);
        const h12 = d.getHours() % 12 || 12;
        const m = d.getMinutes().toString().padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
        labels.push(`${h12}:${m}${ampm}`);
        data.push(count);
      }
    });

    return { labels, data };
  }, [history]);

  if (data.length < 2) return null;

  return (
    <ChartSection
      icon="analytics-outline"
      title="Cumulative Attendance"
      subtitle="Running total of check-ins over time"
      badge={`${data[data.length - 1]} total`}>
      <BarChart
        data={{ labels, datasets: [{ data }] }}
        width={CHART_W}
        height={180}
        chartConfig={{
          ...baseConfig,
          color: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`,
          fillShadowGradient: Palette.accent,
          fillShadowGradientOpacity: 0.9,
        }}
        style={styles.chart}
        fromZero
        withInnerLines={false}
        showValuesOnTopOfBars
        yAxisLabel=""
        yAxisSuffix=""
      />
    </ChartSection>
  );
}

// ─── 3. Capacity Fill – Progress Ring Chart ───────────────────────────────────
function CapacityRingChart({ event }: { event: LocalEvent }) {
  const { fillRate, actual, expected, color } = useMemo(() => {
    const expected = event.expectedAttendees;
    const actual = event.attendeeCount;
    if (!expected || expected <= 0) return { fillRate: null, actual, expected: 0, color: C.yr1 };
    const pct = Math.min(1, actual / expected);
    const color = pct >= 0.9 ? Palette.dangerText : pct >= 0.6 ? C.manual : C.yr1;
    return { fillRate: pct, actual, expected, color };
  }, [event]);

  if (!fillRate && fillRate !== 0) return null;

  const pctDisplay = Math.round(fillRate * 100);

  return (
    <ChartSection
      icon="speedometer-outline"
      title="Capacity Fill Rate"
      subtitle="Checked-in vs expected attendees"
      badge={`${pctDisplay}% filled`}>
      <View style={styles.capacityBody}>
        <ProgressChart
          data={{ labels: ['Capacity'], data: [fillRate] }}
          width={140}
          height={140}
          radius={54}
          chartConfig={{
            ...baseConfig,
            color: (opacity = 1) =>
              `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${opacity})`,
          }}
          hideLegend
          style={{ borderRadius: 12 }}
        />
        <View style={styles.capacityStats}>
          <View style={styles.capacityStatBlock}>
            <Text style={[styles.capacityBigNum, { color }]}>{pctDisplay}%</Text>
            <Text style={styles.capacitySmallLabel}>Fill Rate</Text>
          </View>
          <View style={styles.capacityDivider} />
          <View style={styles.capacityStatBlock}>
            <Text style={styles.capacityBigNum}>{actual}</Text>
            <Text style={styles.capacitySmallLabel}>Checked In</Text>
          </View>
          <View style={styles.capacityDivider} />
          <View style={styles.capacityStatBlock}>
            <Text style={styles.capacityBigNum}>{expected}</Text>
            <Text style={styles.capacitySmallLabel}>Expected</Text>
          </View>
        </View>
      </View>
    </ChartSection>
  );
}

// ─── 4. Year Level Distribution – Pie Chart ───────────────────────────────────
function YearLevelPieChart({ event }: { event: LocalEvent }) {
  const { pieData, total } = useMemo(() => {
    const c = event.yearLevelCounts;
    const rawEntries = [
      { name: '1st', count: c[1], color: C.yr1, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
      { name: '2nd', count: c[2], color: C.yr2, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
      { name: '3rd', count: c[3], color: C.yr3, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
      { name: '4th', count: c[4], color: C.yr4, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
      { name: 'Unset', count: event.unknownYearCount, color: C.unknown, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
    ].filter((e) => e.count > 0);

    const total = rawEntries.reduce((s, e) => s + e.count, 0);
    const pieData = rawEntries.map((e) => ({
      name: `${e.name} (${e.count})`,
      population: e.count,
      color: e.color,
      legendFontColor: e.legendFontColor,
      legendFontSize: e.legendFontSize,
    }));

    return { pieData, total };
  }, [event]);

  if (total === 0) return null;

  return (
    <ChartSection
      icon="people-outline"
      title="Year Level Distribution"
      subtitle="Attendance breakdown by year"
      badge={`${total} attendees`}>
      <PieChart
        data={pieData}
        width={CHART_W}
        height={180}
        chartConfig={baseConfig}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="8"
        style={styles.chart}
        absolute
      />
    </ChartSection>
  );
}

// ─── 5. Year Level Counts – Bar Chart ─────────────────────────────────────────
function YearLevelBarChart({ event }: { event: LocalEvent }) {
  const c = event.yearLevelCounts;
  const hasData = c[1] + c[2] + c[3] + c[4] + event.unknownYearCount > 0;
  if (!hasData) return null;

  const labels = ['1st', '2nd', '3rd', '4th', 'Unset'].filter(
    (_, i) => [c[1], c[2], c[3], c[4], event.unknownYearCount][i] > 0,
  );
  const counts = [c[1], c[2], c[3], c[4], event.unknownYearCount].filter((v) => v > 0);
  const colors = [C.yr1, C.yr2, C.yr3, C.yr4, C.unknown].filter(
    (_, i) => [c[1], c[2], c[3], c[4], event.unknownYearCount][i] > 0,
  );

  return (
    <ChartSection
      icon="bar-chart-outline"
      title="Year Level Counts"
      subtitle="Number of attendees per year level"
      badge={`${event.attendeeCount} total`}>
      <BarChart
        data={{
          labels,
          datasets: [{ data: counts, colors: colors.map((col) => () => col) }],
        }}
        width={CHART_W}
        height={180}
        chartConfig={{
          ...baseConfig,
          color: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`,
        }}
        style={styles.chart}
        fromZero
        withCustomBarColorFromData
        flatColor
        showValuesOnTopOfBars
        withInnerLines={false}
        yAxisLabel=""
        yAxisSuffix=""
      />
      <View style={styles.legendWrap}>
        <LegendRow color={C.yr1} label="1st Year" value={c[1]} />
        <LegendRow color={C.yr2} label="2nd Year" value={c[2]} />
        <LegendRow color={C.yr3} label="3rd Year" value={c[3]} />
        <LegendRow color={C.yr4} label="4th Year" value={c[4]} />
        {event.unknownYearCount > 0 && (
          <LegendRow color={C.unknown} label="Unclassified" value={event.unknownYearCount} />
        )}
      </View>
    </ChartSection>
  );
}

// ─── 6. Check-In Method – Pie Chart ──────────────────────────────────────────
function ScanMethodChart({ history }: { history: AttendanceHistoryItem[] }) {
  const qr = history.filter((h) => h.method === 'qr').length;
  const manual = history.filter((h) => h.method === 'manual').length;

  if (history.length === 0) return null;

  const total = qr + manual;
  const qrPct = total > 0 ? Math.round((qr / total) * 100) : 0;

  const pieData = [
    { name: `QR (${qr})`, population: qr || 0.01, color: C.qr, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
    { name: `Manual (${manual})`, population: manual || 0.01, color: C.manual, legendFontColor: Palette.textSecondary, legendFontSize: 12 },
  ];

  return (
    <ChartSection
      icon="scan-outline"
      title="Check-In Method"
      subtitle="QR scanner vs manual entry"
      badge={`${qrPct}% via QR`}>
      <PieChart
        data={pieData}
        width={CHART_W}
        height={160}
        chartConfig={baseConfig}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="8"
        style={styles.chart}
        absolute
      />
      <View style={styles.legendWrap}>
        <LegendRow color={C.qr} label="QR Scan" value={`${qr} (${qrPct}%)`} />
        <LegendRow color={C.manual} label="Manual Entry" value={`${manual} (${100 - qrPct}%)`} />
      </View>
    </ChartSection>
  );
}

// ─── 7. Sync Status – Progress Rings ─────────────────────────────────────────
function SyncStatusChart({ history }: { history: AttendanceHistoryItem[] }) {
  const synced = history.filter((h) => h.syncStatus === 'synced').length;
  const pending = history.filter((h) => h.syncStatus === 'pending').length;
  const total = history.length;

  if (total === 0) return null;

  const ringData = [Math.min(1, synced / total), Math.min(1, pending / total)];

  return (
    <ChartSection
      icon="cloud-outline"
      title="Sync Status"
      subtitle="Upload state of all attendance records"
      badge={`${synced} of ${total} synced`}>
      <ProgressChart
        data={{
          labels: ['Synced', 'Pending'],
          data: ringData,
          colors: [C.synced, C.pending],
        }}
        width={CHART_W}
        height={160}
        strokeWidth={12}
        radius={28}
        chartConfig={{
          ...baseConfig,
          color: (opacity = 1, index) => {
            const palette = [C.synced, C.pending];
            const hex = palette[index ?? 0] ?? C.synced;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
          },
        }}
        style={styles.chart}
      />
      <View style={styles.legendWrap}>
        <LegendRow color={C.synced} label="Synced" value={synced} />
        <LegendRow color={C.pending} label="Pending" value={pending} />
      </View>
    </ChartSection>
  );
}

// ─── 8. Attendance Timeline – Line Chart ──────────────────────────────────────
function AttendanceTimelineChart({ history }: { history: AttendanceHistoryItem[] }) {
  const { labels, data } = useMemo(() => {
    if (history.length < 2) return { labels: [], data: [] };

    const valid = [...history]
      .filter((h) => !isNaN(new Date(h.recordedAt).getTime()))
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    // Group into 6 equal-width time buckets
    const t0 = new Date(valid[0].recordedAt).getTime();
    const tN = new Date(valid[valid.length - 1].recordedAt).getTime();
    const span = Math.max(tN - t0, 1);
    const BUCKETS = 6;
    const bucketCounts = Array<number>(BUCKETS).fill(0);

    for (const item of valid) {
      const t = new Date(item.recordedAt).getTime();
      const idx = Math.min(BUCKETS - 1, Math.floor(((t - t0) / span) * BUCKETS));
      bucketCounts[idx]++;
    }

    const labels = Array.from({ length: BUCKETS }, (_, i) => {
      const t = new Date(t0 + (span * i) / (BUCKETS - 1));
      const h12 = t.getHours() % 12 || 12;
      const m = t.getMinutes().toString().padStart(2, '0');
      return `${h12}:${m}`;
    });

    return { labels, data: bucketCounts };
  }, [history]);

  if (data.length < 2 || data.every((d) => d === 0)) return null;

  return (
    <ChartSection
      icon="pulse-outline"
      title="Attendance Timeline"
      subtitle="Scan activity across event duration"
      badge={`${history.length} scans total`}>
      <LineChart
        data={{ labels, datasets: [{ data, strokeWidth: 2 }] }}
        width={CHART_W}
        height={180}
        chartConfig={{
          ...baseConfig,
          color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
          fillShadowGradient: '#3B82F6',
          fillShadowGradientOpacity: 0.3,
          propsForDots: {
            r: '5',
            strokeWidth: '2',
            stroke: '#3B82F6',
            fill: '#FFFFFF',
          },
        }}
        style={styles.chart}
        bezier
        fromZero
        withInnerLines={false}
        withDots
      />
    </ChartSection>
  );
}

// ─── Master EventChartsOverview ───────────────────────────────────────────────
export function EventChartsOverview({ event, history }: EventChartsOverviewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.overviewHeader}>
        <Ionicons name="stats-chart-outline" size={18} color={Palette.accent} />
        <Text style={styles.overviewTitle}>Event Analytics</Text>
      </View>

      <ScanTimesChart history={history} />
      <AttendanceTimelineChart history={history} />
      <CumulativeAttendanceChart history={history} />
      <CapacityRingChart event={event} />
      <YearLevelPieChart event={event} />
      <YearLevelBarChart event={event} />
      <ScanMethodChart history={history} />
      <SyncStatusChart history={history} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { gap: 0 },

  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
  },
  overviewTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
    letterSpacing: -0.3,
  },

  section: {
    marginBottom: 20,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Palette.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  badge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.text,
  },
  chartCard: {
    backgroundColor: Palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    padding: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  chart: {
    borderRadius: 10,
    alignSelf: 'center',
  },

  // Capacity Ring
  capacityBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    width: '100%',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  capacityStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    flex: 1,
    justifyContent: 'space-around',
  },
  capacityStatBlock: {
    alignItems: 'center',
    gap: 2,
  },
  capacityBigNum: {
    fontSize: 22,
    fontWeight: '800',
    color: Palette.text,
  },
  capacitySmallLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  capacityDivider: {
    width: 1,
    height: 34,
    backgroundColor: Palette.borderLight,
  },

  // Legend
  legendWrap: {
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Palette.borderLight,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Palette.text,
  },
  legendValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textSecondary,
  },

  // Empty
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
  },
  emptyText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
});

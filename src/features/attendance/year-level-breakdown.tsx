import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';
import {
  formatYearLevel,
  YEAR_LEVELS,
} from '@/features/attendance/year-level';
import type { YearLevelCounts } from '@/features/events/event-types';

type YearLevelBreakdownProps = {
  counts: YearLevelCounts;
  unknownYearCount?: number;
  title?: string;
  subtitle?: string;
};

const YEAR_COLORS = {
  1: {
    bar: '#10B981',
    text: '#047857',
    bg: '#ECFDF5',
  },
  2: {
    bar: '#06B6D4',
    text: '#0E7490',
    bg: '#ECFEFF',
  },
  3: {
    bar: '#3B82F6',
    text: '#1D4ED8',
    bg: '#EFF6FF',
  },
  4: {
    bar: '#8B5CF6',
    text: '#6D28D9',
    bg: '#F5F3FF',
  },
} as const;

export function YearLevelBreakdown({
  counts,
  unknownYearCount = 0,
  title = 'Attendees by year level',
  subtitle = 'Based on the stored year classification for each check-in.',
}: YearLevelBreakdownProps) {
  const classifiedTotal = YEAR_LEVELS.reduce(
    (sum, yearLevel) => sum + counts[yearLevel],
    0,
  );

  return (
    <View style={styles.container}>
      {/* HEADER */}
      {Boolean(title) && (
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>

          {Boolean(subtitle) && (
            <Text style={styles.subtitle}>{subtitle}</Text>
          )}
        </View>
      )}

      {/* 4 YEAR CARDS */}
      <View style={styles.grid}>
        {YEAR_LEVELS.map((yearLevel) => {
          const count = counts[yearLevel];

          const percentage =
            classifiedTotal > 0
              ? Math.round(
                (count / classifiedTotal) * 100,
              )
              : 0;

          const config = YEAR_COLORS[yearLevel];

          return (
            <View key={yearLevel} style={styles.card}>
              {/* TOP */}
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: config.bar,
                    },
                  ]}
                />

                <Text style={styles.percentage}>
                  {percentage}%
                </Text>
              </View>

              {/* YEAR */}
              <Text style={styles.year}>
                {formatYearLevel(yearLevel)}
              </Text>

              {/* COUNT */}
              <View style={styles.countRow}>
                <Text style={styles.count}>
                  {count.toLocaleString()}
                </Text>

                <Text style={styles.attendees}>
                  attendees
                </Text>
              </View>

              {/* PROGRESS */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${percentage}%`,
                      backgroundColor: config.bar,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* UNKNOWN */}
      {unknownYearCount > 0 && (
        <Text style={styles.unknownText}>
          {unknownYearCount.toLocaleString()} check-in
          {unknownYearCount === 1 ? '' : 's'} without year
          level
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /* =========================
     CONTAINER
  ========================= */

  container: {
    gap: 12,
  },

  /* =========================
     HEADER
  ========================= */

  heading: {
    gap: 3,
  },

  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.2,
  },

  subtitle: {
    fontSize: 12,
    color: Palette.textSecondary,
    lineHeight: 17,
  },

  /* =========================
     2 x 2 GRID
  ========================= */

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  /* =========================
     CARD
  ========================= */

  card: {
    width: '48%',
    minHeight: 128,

    padding: 14,

    backgroundColor: '#FFFFFF',

    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,

    justifyContent: 'space-between',
  },

  /* =========================
     TOP
  ========================= */

  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  percentage: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },

  /* =========================
     YEAR
  ========================= */

  year: {
    marginTop: 12,

    fontSize: 13,
    fontWeight: '600',

    color: Palette.textSecondary,
  },

  /* =========================
     COUNT
  ========================= */

  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,

    marginTop: 2,
  },

  count: {
    fontSize: 25,
    lineHeight: 30,

    fontWeight: '700',
    letterSpacing: -0.7,

    color: Palette.text,
  },

  attendees: {
    fontSize: 10,
    color: Palette.textSecondary,
  },

  /* =========================
     PROGRESS
  ========================= */

  progressTrack: {
    height: 4,

    marginTop: 12,

    borderRadius: 2,

    backgroundColor: '#F1F5F9',

    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  /* =========================
     UNKNOWN
  ========================= */

  unknownText: {
    paddingHorizontal: 2,

    fontSize: 11,
    lineHeight: 16,

    color: Palette.textSecondary,
  },
});

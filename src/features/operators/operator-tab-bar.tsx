import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';
import type { OperatorItem } from '@/features/operators/operator-types';

export type OperatorTab = 'All' | 'Admins' | 'Organizers' | 'Volunteers';

type OperatorTabBarProps = {
  activeTab: OperatorTab;
  operators: OperatorItem[];
  hiddenTabs?: OperatorTab[];
  onSelectTab: (tab: OperatorTab) => void;
};

export function OperatorTabBar({
  activeTab,
  operators,
  hiddenTabs = [],
  onSelectTab,
}: OperatorTabBarProps) {
  const allTabs: OperatorTab[] = ['All', 'Admins', 'Organizers', 'Volunteers'];
  const tabs = allTabs.filter((t) => !hiddenTabs.includes(t));

  const getCount = (tab: OperatorTab) => {
    if (tab === 'Admins') {
      return operators.filter((op) => op.role === 'Superadmin').length;
    }
    if (tab === 'Organizers') {
      return operators.filter((op) => op.role === 'Organizer').length;
    }
    if (tab === 'Volunteers') {
      return operators.filter((op) => op.role === 'Volunteer').length;
    }
    return operators.length;
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContainer}
      style={styles.scroll}>
      {tabs.map((tab) => {
        const isSelected = activeTab === tab;
        const count = getCount(tab);

        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelectTab(tab)}
            android_ripple={{ color: 'rgba(0, 0, 0, 0.05)' }}
            style={({ pressed }) => [
              styles.tab,
              isSelected && styles.tabSelected,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.tabText, isSelected && styles.tabTextSelected]}>
              {tab}
            </Text>
            <View style={[styles.badge, isSelected && styles.badgeSelected]}>
              <Text style={[styles.badgeText, isSelected && styles.badgeTextSelected]}>
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    marginTop: 4,
    marginBottom: 4,
  },
  scrollContainer: {
    gap: 8,
    paddingHorizontal: 0,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  tabSelected: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  tabTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  badge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  badgeTextSelected: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.8,
  },
});

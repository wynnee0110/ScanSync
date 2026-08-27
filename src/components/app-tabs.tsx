import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        // TAB BAR
        tabBarStyle: styles.tabBar,

        // TAB SPACING
        tabBarItemStyle: styles.tabBarItem,

        // COLORS
        tabBarActiveTintColor: '#111827',
        tabBarInactiveTintColor: '#9CA3AF',

        // LABELS
        tabBarLabelStyle: styles.tabBarLabel,

        // ICONS
        tabBarIconStyle: styles.tabBarIcon,
      }}>
      {/* HOME */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <Ionicons
              name={focused ? 'grid' : 'grid-outline'}
              size={21}
              color={focused ? '#111827' : '#9CA3AF'}
            />
          ),
        }}
      />

      {/* SCANNER */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarLabelStyle: styles.scannerLabel,
          tabBarIconStyle: styles.scannerIcon,
          tabBarIcon: ({ focused }) => (
            <View style={styles.scannerOuter}>
              <View style={[styles.scannerInner, focused && styles.scannerInnerFocused]}>
                <Ionicons
                  name={focused ? 'scan' : 'scan-outline'}
                  size={24}
                  color={focused ? '#FFFFFF' : '#4B5563'}
                />
              </View>
            </View>
          ),
        }}
      />

      {/* PROFILE */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={21}
              color={focused ? '#111827' : '#9CA3AF'}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    width: 220,
    marginLeft: -110,
    height: 60,
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    elevation: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.12), 0px 2px 6px rgba(0, 0, 0, 0.06)' } as object)
      : {}),
  },
  tabBarItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
    marginBottom: 4,
  },
  tabBarIcon: {
    marginTop: 2,
  },
  scannerLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 0,
  },
  scannerIcon: {
    marginTop: 0,
  },
  scannerOuter: {
    position: 'absolute',
    top: -16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerInnerFocused: {
    backgroundColor: '#111827',
  },
});

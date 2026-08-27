import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';

export function HomeHeader() {
  const { role, user, localUser } = useAuth();

  const userEmail = localUser?.email || user?.email || '';
  const userName = localUser?.name || (userEmail ? userEmail.split('@')[0] : '');

  const displayInitials = userName
    ? userName
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'OP';

  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.greeting}>Welcome back</Text>
        <Text style={styles.title}>{role}</Text>
      </View>

      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{displayInitials}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Palette.text,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Palette.text,
  },
  avatarText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

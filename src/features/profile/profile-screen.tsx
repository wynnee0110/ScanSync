import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';

function Row({
  icon,
  iconBackground,
  iconColor = '#111827',
  title,
  detail,
  detailColor = '#6B7280',
  trailingIcon = 'chevron-forward',
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBackground: string;
  iconColor?: string;
  title: string;
  detail?: string;
  detailColor?: string;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.rowIcon, { backgroundColor: iconBackground }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>

      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: detailColor }]}>{detail}</Text> : null}
      </View>

      <Ionicons name={trailingIcon} size={18} color="#9CA3AF" />
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function ProfileScreen() {
  const { user, localUser, role, isConfigured, signOut } = useAuth();

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  const userEmail = localUser?.email || user?.email || 'operator@icpep.se';
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



  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login' as Href);
  };

  const handleHelpSupport = () => {
    Alert.alert(
      'ICpEP.SE Support',
      'For assistance or account management, contact your Lead Superadmin or email support@icpep.org.',
      [{ text: 'OK' }],
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>Account</Text>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        {/* PROFILE CARD */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View Account Details"
          onPress={() => setShowAccountModal(true)}
          style={({ pressed }) => [styles.card, pressed && styles.rowPressed]}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{displayInitials}</Text>
            </View>

            <View style={styles.profileCopy}>
              <Text style={styles.profileName} numberOfLines={1}>
                {userName || userEmail}
              </Text>
              <Text style={styles.profileRole}>{role ?? 'Operator'}</Text>
              <View style={styles.activeRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>Active</Text>
              </View>
            </View>

            <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          </View>
        </Pressable>

        {/* SYSTEM & DEVICE */}
        <View style={styles.section}>
          <SectionTitle>System & Device</SectionTitle>
          <View style={styles.group}>
            <Row
              icon="wifi-outline"
              iconBackground="#F3F4F6"
              title="Network"
              detail="Connected"
              detailColor="#059669"
              trailingIcon="ellipse"
            />
            <Row
              icon="camera-outline"
              iconBackground="#F3F4F6"
              title="Camera"
              detail="Available"
              detailColor="#059669"
              trailingIcon="checkmark-circle"
            />
          </View>
        </View>

        {/* ACCOUNT & SETTINGS */}
        <View style={styles.section}>
          <SectionTitle>Account & Settings</SectionTitle>
          <View style={styles.group}>
            <Row
              icon="shield-checkmark-outline"
              iconBackground="#F3F4F6"
              title="Security & Privacy"
              onPress={() => setShowSecurityModal(true)}
            />
            <Row
              icon="help-circle-outline"
              iconBackground="#F3F4F6"
              title="Help & Support"
              onPress={handleHelpSupport}
            />
            <Row
              icon="log-out-outline"
              iconBackground="#FFE4E6"
              iconColor="#EF4444"
              title="Sign Out"
              detailColor="#E11D48"
              trailingIcon="chevron-forward"
              onPress={handleSignOut}
            />
          </View>
        </View>

        <Text style={styles.footer}>ScanSync v1.0.0 • ICpEP.SE</Text>
      </ScrollView>

      {/* ACCOUNT INFORMATION MODAL */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAccountModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Account Information</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowAccountModal(false)}
                hitSlop={8}>
                <Ionicons name="close-circle-outline" size={26} color="#6B7280" />
              </Pressable>
            </View>

            <View style={styles.modalProfileBadge}>
              <View style={styles.modalAvatar}>
                <Text style={styles.modalAvatarText}>{displayInitials}</Text>
              </View>
              <Text style={styles.modalName}>{userName || userEmail}</Text>
              <Text style={styles.modalEmail}>{userEmail}</Text>
            </View>

            <View style={styles.infoList}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Account Role</Text>
                <Text style={styles.infoValBold}>{role}</Text>
              </View>



              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Assigned Scope</Text>
                <Text style={styles.infoVal}>
                  {localUser?.assignedEventId ? `Event ID: ${localUser.assignedEventId}` : 'All Events'}
                </Text>
              </View>

              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Auth Mode</Text>
                <Text style={styles.infoVal}>
                  {isConfigured ? 'Supabase Authorized' : 'Local Outbox Sync'}
                </Text>
              </View>

              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Status</Text>
                <Text style={styles.statusActiveText}>Active & Synced</Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAccountModal(false)}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.rowPressed]}>
              <Text style={styles.closeBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* SECURITY MODAL */}
      <Modal
        visible={showSecurityModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSecurityModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Security & Privacy</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowSecurityModal(false)}
                hitSlop={8}>
                <Ionicons name="close-circle-outline" size={26} color="#6B7280" />
              </Pressable>
            </View>

            <View style={styles.infoList}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Authentication</Text>
                <Text style={styles.infoVal}>
                  {isConfigured ? 'Supabase JWT Session' : 'Encrypted Local Session'}
                </Text>
              </View>

              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Local SQLite Cache</Text>
                <Text style={styles.statusActiveText}>Idempotent Outbox Protection</Text>
              </View>

              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Data Privacy</Text>
                <Text style={styles.infoVal}>Unsigned QR PII Sanitized</Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSecurityModal(false)}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.rowPressed]}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerEyebrow: {
    fontSize: 14,
    fontWeight: '500',
    color: Palette.textSecondary,
  },
  headerTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '700',
    color: Palette.text,
  },
  card: {
    marginHorizontal: 24,
    borderRadius: 24,
    backgroundColor: Palette.surface,
    padding: 20,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Palette.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileCopy: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  profileRole: {
    marginTop: 4,
    fontSize: 14,
    color: Palette.textSecondary,
  },
  activeRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.success,
  },
  activeText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '500',
    color: Palette.successText,
  },
  section: {
    marginHorizontal: 24,
    marginTop: 24,
  },
  sectionTitle: {
    marginBottom: 12,
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  group: {
    borderRadius: 24,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderLight,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    marginLeft: 12,
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.text,
  },
  rowDetail: {
    marginTop: 2,
    fontSize: 12,
  },
  footer: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 12,
    color: Palette.textMuted,
  },
  editBtn: {
    padding: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
  },
  modalProfileBadge: {
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderLight,
    marginBottom: 16,
  },
  modalAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Palette.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalName: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  modalEmail: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  infoList: {
    gap: 12,
    marginBottom: 24,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  infoVal: {
    fontSize: 13,
    color: Palette.text,
    fontWeight: '500',
  },
  infoValBold: {
    fontSize: 13,
    color: Palette.text,
    fontWeight: '700',
  },
  statusActiveText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.successText,
  },
  closeBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

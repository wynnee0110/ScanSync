import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import { listEvents } from '@/features/events/event-repository';
import { isEventCreatedByUser, type LocalEvent } from '@/features/events/event-types';
import {
  getOperatorAccessStatus,
  MOCK_OPERATOR_LOGS,
  type OperatorActivityLog,
} from '@/features/operators/operator-helpers';
import { getOperators, removeOperator, subscribeOperators, updateOperator } from '@/features/operators/operator-store';

export function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, localUser, role: userRole, assignedEventId: userAssignedEventId } = useAuth();
  const isOrganizerViewer = userRole === 'Organizer';

  const [showPassword, setShowPassword] = useState(false);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [operators, setOperators] = useState(getOperators());
  const [reassignModalOpen, setReassignModalOpen] = useState(false);

  useEffect(() => {
    void listEvents().then(setEvents).catch(() => {});
    const unsub = subscribeOperators(() => {
      setOperators([...getOperators()]);
    });
    return unsub;
  }, []);

  const organizerEvents = useMemo(() => {
    return events.filter(
      (e) =>
        isEventCreatedByUser(e.createdBy, user, localUser) ||
        e.id === userAssignedEventId,
    );
  }, [events, user, localUser, userAssignedEventId]);

  const operator = operators.find(
    (op) => op.id === id || (id && op.email.toLowerCase() === id.toLowerCase()),
  );

  if (!operator) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="person-remove-outline" size={56} color={Palette.textSecondary} />
          <Text style={{ marginTop: 16, fontSize: 18, fontWeight: '700', color: Palette.text }}>
            Operator Profile Not Found
          </Text>
          <Text style={{ marginTop: 8, fontSize: 13, color: Palette.textSecondary, textAlign: 'center' }}>
            This operator account has been removed or revoked from the database.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={{
              marginTop: 24,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: Palette.text,
            }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF' }}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const availableEvents = isOrganizerViewer ? organizerEvents : events;
  const access = operator ? getOperatorAccessStatus(operator, events) : { label: 'UNASSIGNED', isRevoked: true, color: '#6B7280', bgColor: '#F3F4F6' };
  const activityLogs: OperatorActivityLog[] = (operator && MOCK_OPERATOR_LOGS[operator.id]) ?? [];

  const handleRevokeAccess = () => {
    if (!operator) return;
    if (operator.role === 'Superadmin') {
      Alert.alert('Action Restricted', 'Superadmin accounts cannot be revoked.');
      return;
    }

    if (isOrganizerViewer) {
      const organizerEventIds = new Set(organizerEvents.map((e) => e.id));
      const isCreatedByMe = isEventCreatedByUser(operator.createdBy, user, localUser);
      const isAssignedToMyEvent = Boolean(operator.assignedEventId && organizerEventIds.has(operator.assignedEventId));
      if (operator.role !== 'Volunteer' || (!isCreatedByMe && !isAssignedToMyEvent)) {
        Alert.alert('Action Restricted', 'Organizers can only manage Volunteers assigned to their events.');
        return;
      }
    }

    Alert.alert(
      'Revoke Access',
      `Are you sure you want to revoke access for ${operator.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            removeOperator(operator.id);
            Alert.alert('Access Revoked', `Access for ${operator.name} has been revoked.`);
            router.back();
          },
        },
      ],
    );
  };

  const handleReassignEvent = (targetEvent: LocalEvent) => {
    if (!operator) return;
    updateOperator(operator.id, {
      assignedEventId: targetEvent.id,
      assignedEventName: targetEvent.name,
    });
    setReassignModalOpen(false);
    Alert.alert('Event Reassigned', `Reassigned ${operator.name} to "${targetEvent.name}".`);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Operators"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
          android_ripple={{ color: 'rgba(0, 0, 0, 0.08)', borderless: true }}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>User Profile & Activity</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarLarge}>
              <Ionicons name="person" size={32} color={Palette.accent} />
            </View>
            <View style={styles.profileMain}>
              <Text style={styles.userName}>{operator.name}</Text>
              <Text style={styles.userEmail}>{operator.email}</Text>
              <View style={styles.roleRow}>
                <View style={styles.roleChip}>
                  <Text style={styles.roleChipText}>{operator.role}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: access.bgColor }]}>
                  <Text style={[styles.statusText, { color: access.color }]}>
                    {access.label}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Access Credentials Box */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Access Credentials</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={16} color={Palette.textSecondary} />
              <Text style={styles.infoLabel}>Access Email:</Text>
              <Text style={styles.infoValue}>{operator.email}</Text>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="key-outline" size={16} color={Palette.textSecondary} />
              <Text style={styles.infoLabel}>Password Code:</Text>
              <Text style={styles.codeText}>
                {showPassword ? operator.generatedPasswordCode : '••••••••'}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setShowPassword((prev) => !prev)}
                style={styles.eyeBtn}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={Palette.accent}
                />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Assigned Event Details */}
        <View style={styles.card}>
          <View style={styles.cardTitleHeader}>
            <Text style={styles.cardTitle}>Assigned Event Access</Text>
            {operator.role === 'Volunteer' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reassign volunteer event"
                onPress={() => setReassignModalOpen(true)}
                style={({ pressed }) => [styles.editEventBtn, pressed && styles.pressed]}>
                <Ionicons name="create-outline" size={14} color={Palette.accent} />
                <Text style={styles.editEventBtnText}>Reassign Event</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.eventBox}>
            <View style={styles.eventIconBg}>
              <Ionicons name="calendar" size={20} color={Palette.accent} />
            </View>
            <View style={styles.eventDetails}>
              <Text style={styles.eventName}>{operator.assignedEventName}</Text>
              <Text style={styles.eventSubtitle}>
                {operator.role === 'Superadmin'
                  ? 'Superadmin Access to All Events'
                  : 'Authorized Event Scanner'}
              </Text>
            </View>
          </View>
        </View>

        {/* Activity & Scan Dashboard Metrics */}
        <Text style={styles.sectionHeader}>Scan Dashboard & Metrics</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{operator.scansCount}</Text>
            <Text style={styles.metricLabel}>Total Scans</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricValue, { color: Palette.successText }]}>
              {Math.min(operator.scansCount, 18)}
            </Text>
            <Text style={styles.metricLabel}>Scans Today</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricValue, { color: Palette.accent }]}>0</Text>
            <Text style={styles.metricLabel}>Pending Sync</Text>
          </View>
        </View>

        {/* Recent Scan History */}
        <Text style={styles.sectionHeader}>Recent Activity Log</Text>
        <View style={styles.logContainer}>
          {activityLogs.map((log: OperatorActivityLog) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logIconBox}>
                <Ionicons
                  name={log.method === 'qr' ? 'qr-code-outline' : 'create-outline'}
                  size={16}
                  color={Palette.accent}
                />
              </View>
              <View style={styles.logContent}>
                <View style={styles.logTitleRow}>
                  <Text style={styles.logName}>{log.participantName}</Text>
                  <Text style={styles.logTime}>{log.timestamp}</Text>
                </View>
                <Text style={styles.logSubtitle}>
                  ID: {log.studentId} · {log.method.toUpperCase()} Check-in
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Revoke Access Button */}
        {operator.role !== 'Superadmin' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Revoke user access"
            onPress={handleRevokeAccess}
            android_ripple={{ color: 'rgba(239, 68, 68, 0.15)' }}
            style={({ pressed }) => [styles.revokeBtn, pressed && styles.pressed]}>
            <Ionicons name="trash-outline" size={16} color={Palette.danger} />
            <Text style={styles.revokeBtnText}>Revoke Operator Access</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Reassign Event Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={reassignModalOpen}
        onRequestClose={() => setReassignModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Reassign Event Access</Text>
            <Text style={styles.modalSubtitle}>
              Select an event to assign to {operator.name}
            </Text>

            <ScrollView contentContainerStyle={styles.reassignList}>
              {availableEvents.length === 0 ? (
                <Text style={styles.noEventsText}>No available events to assign.</Text>
              ) : (
                availableEvents.map((ev) => {
                  const isSelected = operator.assignedEventId === ev.id;
                  return (
                    <Pressable
                      key={ev.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => handleReassignEvent(ev)}
                      style={({ pressed }) => [
                        styles.reassignOption,
                        isSelected && styles.reassignOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={isSelected ? Palette.accent : Palette.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reassignOptionName}>{ev.name}</Text>
                        <Text style={styles.reassignOptionStatus}>
                          Status: {ev.status.toUpperCase()}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => setReassignModalOpen(false)}
              style={styles.closeModalBtn}>
              <Text style={styles.closeModalBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardTitleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editEventBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  editEventBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.accent,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Palette.borderLight,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginBottom: 16,
  },
  reassignList: {
    gap: 8,
    paddingBottom: 16,
  },
  noEventsText: {
    fontSize: 13,
    color: Palette.textSecondary,
    textAlign: 'center',
    paddingVertical: 16,
  },
  reassignOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    backgroundColor: Palette.background,
  },
  reassignOptionSelected: {
    borderColor: Palette.accent,
    backgroundColor: '#F3F4F6',
  },
  reassignOptionName: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  reassignOptionStatus: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  closeModalBtn: {
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  closeModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
    backgroundColor: Palette.surface,
  },
  backButton: {
    padding: 6,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
    marginLeft: 8,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },
  profileCard: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarLarge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  profileMain: {
    flex: 1,
    gap: 4,
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  userEmail: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  roleChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  card: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    gap: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  infoGrid: {
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.text,
    flex: 1,
  },
  codeText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: Palette.accent,
    letterSpacing: 1,
  },
  eyeBtn: {
    padding: 4,
    marginLeft: 6,
  },
  eventBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Palette.background,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  eventIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventDetails: {
    flex: 1,
  },
  eventName: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  eventSubtitle: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
    marginTop: 8,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Palette.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Palette.text,
  },
  metricLabel: {
    fontSize: 11,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  logContainer: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    padding: 12,
    gap: 12,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logContent: {
    flex: 1,
  },
  logTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logName: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  logTime: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  logSubtitle: {
    fontSize: 11,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
    marginBottom: 24,
  },
  revokeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.danger,
  },
  pressed: {
    opacity: 0.7,
  },
});

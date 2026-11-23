import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HotToast, type ToastMessage } from '@/components/hot-toast';
import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import { listEvents } from '@/features/events/event-repository';
import { isEventCreatedByUser, type LocalEvent } from '@/features/events/event-types';
import { AddOperatorModal } from '@/features/operators/add-operator-modal';
import { OperatorCard } from '@/features/operators/operator-card';
import {
  canDeleteOperator,
  generateAccessCode,
  getOperatorAccessStatus,
  isSuperadmin,
} from '@/features/operators/operator-helpers';
import {
  addOperator,
  getOperators,
  publishPendingOperators,
  removeOperator,
  subscribeOperators,
  syncOperatorsFromSupabase,
} from '@/features/operators/operator-store';
import { OperatorTabBar, type OperatorTab } from '@/features/operators/operator-tab-bar';
import type { OperatorItem, OperatorRole } from '@/features/operators/operator-types';
import { OperatorsStatsCard } from '@/features/operators/operators-stats-card';

import { createUuid } from '@/lib/uuid';

export default function OperatorsScreenDashboard() {
  const { user, localUser, role: userRole, assignedEventId: userAssignedEventId } = useAuth();
  const userEmail = (localUser?.email || user?.email || '').toLowerCase();
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [operators, setOperators] = useState<OperatorItem[]>(getOperators());
  const [activeTab, setActiveTab] = useState<OperatorTab>('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const isSuperadminViewer = isSuperadmin(userRole, userEmail);
  const isVolunteerViewer = userRole === 'Volunteer' && !isSuperadminViewer;
  const isOrganizerViewer = userRole === 'Organizer' && !isSuperadminViewer;

  const organizerEvents = events.filter(
    (e) =>
      isEventCreatedByUser(e.createdBy, user, localUser) ||
      e.id === userAssignedEventId,
  );

  const viewerEventId = userAssignedEventId ?? (organizerEvents.length > 0 ? organizerEvents[0].id : null);
  const viewerEventName =
    organizerEvents.find((e) => e.id === viewerEventId)?.name ??
    (organizerEvents.length > 0 ? `${organizerEvents.length} Managed Events` : 'All Created Events');

  useEffect(() => {
    if (isVolunteerViewer) {
      Alert.alert('Access Restricted', 'Volunteers do not have permission to view operator management.');
      router.replace('/scan');
    }
  }, [isVolunteerViewer]);

  // -------------------------------------------------------------------------
  // Form state for Add modal
  // -------------------------------------------------------------------------
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<OperatorRole>('Volunteer');
  const [formEventId, setFormEventId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const loadEvents = useCallback(async () => {
    try {
      const realEvents = await listEvents();
      setEvents(realEvents);
    } catch {
      // Keep existing state if fetch fails.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadEvents();
      void syncOperatorsFromSupabase();
    }, [loadEvents]),
  );

  // Subscribe to module-level store so newly added/removed operators
  // are reflected without requiring a full reload.
  useEffect(() => {
    void syncOperatorsFromSupabase();
    const unsub = subscribeOperators(() => {
      setOperators([...getOperators()]);
    });
    return unsub;
  }, []);

  if (isVolunteerViewer) {
    return null;
  }

  // -------------------------------------------------------------------------
  // Add modal handlers
  // -------------------------------------------------------------------------
  const handleOpenAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('Volunteer');

    const availEvents = isOrganizerViewer ? organizerEvents : events;
    setFormEventId(availEvents.length > 0 ? availEvents[0].id : null);

    setIsAddModalOpen(true);
  };

  const handleRoleChange = (role: OperatorRole) => {
    setFormRole(role);
    if (role === 'Superadmin' || role === 'Organizer') {
      setFormEventId(null);
    } else if (role === 'Volunteer' && !formEventId) {
      const availEvents = isOrganizerViewer ? organizerEvents : events;
      setFormEventId(availEvents.length > 0 ? availEvents[0].id : null);
    }
  };

  const handleCreateOperator = async () => {
    if (!formName.trim()) {
      Alert.alert('Validation Error', 'Please enter the operator name.');
      return;
    }
    const targetEmail = formEmail.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      Alert.alert('Validation Error', 'Please enter a valid access email address.');
      return;
    }

    const existingOp = operators.find((o) => o.email.toLowerCase() === targetEmail);
    if (existingOp) {
      Alert.alert(
        'Account Already Exists',
        `An operator account with email "${targetEmail}" has already been created. Duplicate accounts are not permitted.`,
      );
      return;
    }

    // Only Volunteers require an assigned event.
    if (formRole === 'Volunteer' && !formEventId) {
      Alert.alert('Validation Error', 'Please select an event to assign this volunteer to.');
      return;
    }

    if (formPassword.trim().length > 0 && formPassword.trim().length < 6) {
      Alert.alert(
        'Validation Error',
        'Access password must be at least 6 characters (or leave blank to auto-generate).',
      );
      return;
    }

    let assignedEventName = 'All Events (Superadmin)';
    let finalEventId = formEventId;

    if (formRole === 'Organizer') {
      assignedEventName = 'All Created Events (Organizer)';
      finalEventId = null;
    } else if (formRole === 'Volunteer') {
      const availEvents = isOrganizerViewer ? organizerEvents : events;
      const found = availEvents.find((e) => e.id === formEventId) ?? events.find((e) => e.id === formEventId);
      finalEventId = formEventId || availEvents[0]?.id || events[0]?.id || null;
      assignedEventName = found?.name ?? (availEvents[0]?.name || events[0]?.name || viewerEventName);
    }

    const finalPassword = formPassword.trim() || generateAccessCode(formRole);

    const newOperator: OperatorItem = {
      id: createUuid(),
      name: formName.trim(),
      email: formEmail.trim().toLowerCase(),
      role: formRole,
      assignedEventId: finalEventId,
      assignedEventName,
      generatedPasswordCode: finalPassword,
      scansCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: user?.id || localUser?.id || userEmail,
    };

    addOperator(newOperator);
    setOperators([newOperator, ...getOperators()]);
    setIsAddModalOpen(false);

    Alert.alert(
      isOrganizerViewer ? 'Volunteer Added' : 'Operator Access Created',
      `New ${formRole.toLowerCase()} account created successfully!\n\nEmail: ${newOperator.email}\nPassword Code: ${newOperator.generatedPasswordCode}\nAssigned Event: ${newOperator.assignedEventName}`,
    );

  };

  const handlePublishOperators = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const published = await publishPendingOperators();
      setToast({
        type: 'success',
        title: 'Sync Complete',
        message:
          published > 0
            ? `${published} local account(s) are now available to authorized users.`
            : 'There are no local account changes to publish.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('offline') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        setToast({
          type: 'offline',
          title: 'Cannot Sync Offline',
          message: 'Connect to Wi-Fi or mobile data to publish operator changes.',
        });
      } else {
        setToast({
          type: 'error',
          title: 'Sync Failed',
          message: 'Your local accounts remain on this device. Check the connection and try again.',
        });
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteOperator = (id: string, name: string) => {
    const targetOp = operators.find((op) => op.id === id);
    if (!targetOp) return;

    const deletionCheck = canDeleteOperator(
      { id: localUser?.id || user?.id, email: userEmail, role: userRole },
      targetOp,
    );

    if (!deletionCheck.allowed) {
      Alert.alert('Action Restricted', deletionCheck.reason || 'You do not have permission to delete this account.');
      return;
    }

    if (isOrganizerViewer) {
      const organizerEventIds = new Set(organizerEvents.map((e) => e.id));
      const isCreatedByMe = isEventCreatedByUser(targetOp.createdBy, user, localUser);
      const isAssignedToMyEvent = Boolean(targetOp.assignedEventId && organizerEventIds.has(targetOp.assignedEventId));
      if (targetOp.role !== 'Volunteer' || (!isCreatedByMe && !isAssignedToMyEvent)) {
        Alert.alert('Action Restricted', 'Organizers can only manage Volunteers assigned to their events.');
        return;
      }
    }

    Alert.alert('Revoke & Remove', `Are you sure you want to remove operator "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeOperator(id);
          setOperators(getOperators().filter((op) => op.id !== id));
        },
      },
    ]);
  };

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const activeOperatorsCount = operators.filter(
    (op) => !getOperatorAccessStatus(op, events).isRevoked,
  ).length;

  const totalScansCount = operators.reduce((sum, op) => sum + op.scansCount, 0);

  const filteredOperators = operators.filter((op) => {
    // Organizer view: show volunteers created by or assigned to events created/managed by this organizer.
    if (isOrganizerViewer) {
      const organizerEventIds = new Set(organizerEvents.map((e) => e.id));
      const isCreatedByMe = isEventCreatedByUser(op.createdBy, user, localUser);
      const isAssignedToMyEvent = Boolean(op.assignedEventId && organizerEventIds.has(op.assignedEventId));
      return (
        op.role === 'Volunteer' &&
        (isCreatedByMe || isAssignedToMyEvent)
      );
    }
    // Superadmin view: tab filter.
    if (activeTab === 'Admins') return op.role === 'Superadmin';
    if (activeTab === 'Organizers') return op.role === 'Organizer';
    if (activeTab === 'Volunteers') return op.role === 'Volunteer';
    return true;
  });

  const hiddenTabs: OperatorTab[] = isOrganizerViewer ? ['All', 'Admins', 'Organizers'] : [];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <HotToast toast={toast} onDismiss={() => setToast(null)} />
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
          android_ripple={{ color: 'rgba(0, 0, 0, 0.08)', borderless: true }}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Operators Dashboard</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Publish local operator accounts"
          disabled={publishing}
          onPress={() => void handlePublishOperators()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name={publishing ? 'sync' : 'cloud-upload-outline'} size={21} color={Palette.accent} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>

        {/* ---------------------------------------------------------------- */}
        {/* ROLE CONTEXT BANNER */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.roleBannerCard}>
          <View style={styles.roleBannerLeft}>
            <Ionicons
              name={isOrganizerViewer ? 'person-circle-outline' : 'shield-checkmark-outline'}
              size={20}
              color={isOrganizerViewer ? '#7E22CE' : Palette.accent}
            />
            <View style={styles.roleBannerText}>
              <Text style={styles.roleBannerTitle}>
                {isOrganizerViewer ? 'Organizer Scope' : 'Superadmin Access'}
              </Text>
              <Text style={styles.roleBannerSubtitle}>
                {isOrganizerViewer
                  ? 'Create & manage events, and assign Volunteers to your events'
                  : 'Full access — manage Organizers, Volunteers, and Events'}
              </Text>
            </View>
          </View>
        </View>

        {/* Organizer view — assigned event context */}
        {isOrganizerViewer && (
          <View style={styles.organizerEventBox}>
            <View style={styles.organizerEventHeader}>
              <Ionicons name="calendar-outline" size={15} color={Palette.textSecondary} />
              <Text style={styles.organizerEventLabel}>Your Event Scope</Text>
            </View>
            <Text style={styles.organizerEventName}>{viewerEventName}</Text>
          </View>
        )}

        {/* Overview Stats (Superadmin only — full picture) */}
        {!isOrganizerViewer && (
          <OperatorsStatsCard
            totalStaff={operators.length}
            activeAccess={activeOperatorsCount}
            totalScans={totalScansCount}
          />
        )}

        {/* Section Header & Add CTA */}
        <View style={styles.sectionHeader}>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.sectionTitle}>
              {isOrganizerViewer ? 'Event Volunteers' : 'Management & Staff'}
            </Text>
            <Text style={styles.sectionSubtitle}>
              {isOrganizerViewer
                ? 'Volunteers assigned to your managed events'
                : 'Manage organizers, volunteers, and access codes'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isOrganizerViewer ? 'Add volunteer' : 'Add new operator'}
            onPress={handleOpenAddModal}
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            style={({ pressed }) => [styles.addOperatorBtn, pressed && styles.pressed]}>
            <Ionicons name="person-add" size={16} color="#FFFFFF" />
            <Text style={styles.addOperatorText}>
              {isOrganizerViewer ? 'Add Volunteer' : 'Add Operator'}
            </Text>
          </Pressable>
        </View>

        {/* ROLE TAB FILTER BAR */}
        {!isOrganizerViewer && (
          <OperatorTabBar
            activeTab={activeTab}
            operators={operators}
            hiddenTabs={hiddenTabs}
            onSelectTab={setActiveTab}
          />
        )}

        {/* OPERATORS LIST */}
        {filteredOperators.length === 0 ? (
          <View style={styles.emptyGroupCard}>
            <Ionicons
              name={isOrganizerViewer ? 'people-outline' : 'person-outline'}
              size={24}
              color={Palette.textSecondary}
              style={{ marginBottom: 6 }}
            />
            <Text style={styles.emptyGroupText}>
              {isOrganizerViewer
                ? 'No volunteers assigned to your events yet.'
                : `No ${activeTab.toLowerCase()} found.`}
            </Text>
            <Text style={styles.emptyGroupSubText}>
              {isOrganizerViewer
                ? 'Tap "Add Volunteer" to assign one.'
                : 'Tap "Add Operator" to create one.'}
            </Text>
          </View>
        ) : (
          filteredOperators.map((op) => {
            const canDelete = canDeleteOperator(
              { id: localUser?.id || user?.id, email: userEmail, role: userRole },
              op,
            ).allowed;
            return (
              <OperatorCard
                key={op.id}
                operator={op}
                events={events}
                canDelete={canDelete}
                onDelete={handleDeleteOperator}
              />
            );
          })
        )}
      </ScrollView>

      {/* Add Operator / Add Volunteer Modal */}
      <AddOperatorModal
        isOpen={isAddModalOpen}
        events={isOrganizerViewer ? organizerEvents : events}
        formName={formName}
        formEmail={formEmail}
        formPassword={formPassword}
        formRole={formRole}
        formEventId={formEventId}
        isOrganizerContext={isOrganizerViewer}
        lockedEventName={viewerEventName}
        onChangeName={setFormName}
        onChangeEmail={setFormEmail}
        onChangePassword={setFormPassword}
        onChangeRole={handleRoleChange}
        onChangeEventId={setFormEventId}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleCreateOperator}
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: 48,
  },

  // --- Role Banner ---
  roleBannerCard: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    gap: 12,
  },
  roleBannerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  roleBannerText: {
    flex: 1,
    gap: 2,
  },
  roleBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  roleBannerSubtitle: {
    fontSize: 12,
    color: Palette.textSecondary,
    lineHeight: 16,
  },
  roleSwitcherRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rolePill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    backgroundColor: Palette.background,
  },
  rolePillActive: {
    borderColor: Palette.accent,
    backgroundColor: Palette.accent,
  },
  rolePillOrganizer: {
    borderColor: '#7E22CE',
    backgroundColor: '#7E22CE',
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  rolePillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // --- Organizer Event Box ---
  organizerEventBox: {
    backgroundColor: '#F3E8FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 10,
  },
  organizerEventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  organizerEventLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  organizerEventName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7E22CE',
  },
  organizerEventPills: {
    gap: 8,
    paddingBottom: 2,
  },
  organizerEventPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D8B4FE',
    backgroundColor: '#FFFFFF',
  },
  organizerEventPillSelected: {
    backgroundColor: '#7E22CE',
    borderColor: '#7E22CE',
  },
  organizerEventPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7E22CE',
  },
  organizerEventPillTextSelected: {
    color: '#FFFFFF',
  },

  // --- Section Header ---
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 12,
  },
  headerTitleContainer: {
    flex: 1,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  addOperatorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    flexShrink: 0,
  },
  addOperatorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // --- Empty state ---
  emptyGroupCard: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderStyle: 'dashed',
    backgroundColor: Palette.surface,
    alignItems: 'center',
    gap: 4,
  },
  emptyGroupText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  emptyGroupSubText: {
    fontSize: 12,
    color: Palette.textSecondary,
    textAlign: 'center',
  },

  pressed: {
    opacity: 0.7,
  },
});

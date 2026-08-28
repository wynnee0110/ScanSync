import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatePickerModal } from '@/components/date-picker-modal';
import { TimePickerModal } from '@/components/time-picker-modal';
import { HotToast, type ToastMessage } from '@/components/hot-toast';
import { Palette } from '@/constants/palette';
import { SELECTED_EVENT_KEY, setPreference } from '@/lib/preferences';
import { HistorySection } from '@/features/attendance/history-section';
import { EventChartsOverview } from '@/features/charts/event-charts-overview';
import {
  deleteEvent,
  getEventById,
  getPendingSyncCountForEvent,
  listAttendanceHistory,
  toggleEventStatus,
  updateEvent,
} from '@/features/events/event-repository';
import type { AttendanceHistoryItem, EventStatus, LocalEvent } from '@/features/events/event-types';
import { formatEventStatus, formatEventTimeRange } from '@/features/events/formatters';
import { processSyncQueue } from '@/lib/sync-worker';
import { useAuth } from '@/features/auth/auth-context';

function parseTimeComponents(timeStr: string): { hour: number; minute: number } | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();

  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else {
    if (hour < 0 || hour > 23) return null;
  }
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseLocalDateTime(dateValue: string, timeValue: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())) {
    return null;
  }
  const timeComp = parseTimeComponents(timeValue);
  if (!timeComp) return null;

  const [year, month, day] = dateValue.trim().split('-').map(Number);
  const { hour, minute } = timeComp;

  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  const isExact =
    value.getFullYear() === year &&
    value.getMonth() === month - 1 &&
    value.getDate() === day &&
    value.getHours() === hour &&
    value.getMinutes() === minute;
  return isExact ? value.toISOString() : null;
}

type EventDetailScreenProps = {
  eventId: string;
};

export function EventDetailScreen({ eventId }: EventDetailScreenProps) {
  const [event, setEvent] = useState<LocalEvent | null>(null);
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editExpected, setEditExpected] = useState('');
  const [editAcademicReferenceYear, setEditAcademicReferenceYear] = useState('');
  const [editStatus, setEditStatus] = useState<EventStatus>('active');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [endTimePickerOpen, setEndTimePickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirm modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Sync state
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const { user, localUser, role: userRole, assignedEventId } = useAuth();
  const userEmail = (localUser?.email || user?.email || '').toLowerCase();
  const isVolunteer = userRole === 'Volunteer';

  useEffect(() => {
    if (isVolunteer) {
      Alert.alert('Access Restricted', 'Volunteers do not have permission to view event management dashboard.');
      router.replace('/scan');
    }
  }, [isVolunteer]);

  const reload = useCallback(async () => {
    try {
      const [fetchedEvent, fetchedHistory] = await Promise.all([
        getEventById(eventId),
        listAttendanceHistory(200, eventId),
      ]);

      if (!fetchedEvent) {
        setError('Event not found.');
      } else {
        if (userRole === 'Organizer') {
          const isOwnerOrAssigned =
            (fetchedEvent.createdBy && fetchedEvent.createdBy.toLowerCase() === userEmail) ||
            fetchedEvent.id === assignedEventId;

          if (!isOwnerOrAssigned) {
            setError('Access Restricted: You do not have permission to view this event.');
            setLoading(false);
            return;
          }
        }



        setEvent(fetchedEvent);
        setHistory(fetchedHistory);
        setError(null);
        // Update pending sync badge
        try {
          const pending = await getPendingSyncCountForEvent(fetchedEvent.id);
          setPendingSyncCount(pending);
        } catch {
          // non-fatal
        }
      }
    } catch {
      setError('Could not load event data.');
    } finally {
      setLoading(false);
    }
  }, [eventId, userRole, userEmail, assignedEventId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleToggleStatus = useCallback(async () => {
    if (!event) return;
    const nextStatus: EventStatus =
      event.status === 'active'
        ? 'draft'
        : event.status === 'draft'
          ? 'completed'
          : 'active';
    try {
      await toggleEventStatus(event.id, nextStatus);
      void reload();
    } catch {
      // Keep existing state
    }
  }, [event, reload]);



  const openEditModal = useCallback(() => {
    if (!event) return;
    setEditName(event.name);
    setEditVenue(event.venue);
    const d = new Date(event.startsAt);
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    setEditDate(`${year}-${month}-${day}`);

    let hours = d.getHours();
    const isPm = hours >= 12;
    hours = hours % 12 || 12;
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const period = isPm ? 'PM' : 'AM';
    setEditTime(`${hours.toString().padStart(2, '0')}:${minutes} ${period}`);

    const dEnd = event.endsAt
      ? new Date(event.endsAt)
      : new Date(new Date(event.startsAt).getTime() + 4 * 60 * 60 * 1000);
    if (!isNaN(dEnd.getTime())) {
      let hoursEnd = dEnd.getHours();
      const isPmEnd = hoursEnd >= 12;
      hoursEnd = hoursEnd % 12 || 12;
      const minutesEnd = dEnd.getMinutes().toString().padStart(2, '0');
      const periodEnd = isPmEnd ? 'PM' : 'AM';
      setEditEndTime(`${hoursEnd.toString().padStart(2, '0')}:${minutesEnd} ${periodEnd}`);
    }

    setEditExpected(event.expectedAttendees ? String(event.expectedAttendees) : '');
    setEditAcademicReferenceYear(String(event.academicReferenceYear));
    setEditStatus(event.status);
    setFormError(null);
    setEditModalOpen(true);
  }, [event]);

  const handleSaveEdit = useCallback(async () => {
    if (!event || submitting) return;

    if (!editName.trim()) {
      setFormError('Event name is required.');
      return;
    }
    if (!editVenue.trim()) {
      setFormError('Venue is required.');
      return;
    }

    const isoStartsAt = parseLocalDateTime(editDate, editTime);
    const parsedEndsAt = parseLocalDateTime(editDate, editEndTime);
    const fallbackEndsAt = isoStartsAt
      ? new Date(new Date(isoStartsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();
    const isoEndsAt = parsedEndsAt ?? fallbackEndsAt;

    if (!isoStartsAt) {
      setFormError('Invalid start date or time format. Use YYYY-MM-DD and HH:MM AM/PM.');
      return;
    }
    if (!parsedEndsAt) {
      setFormError('Invalid end time format.');
      return;
    }
    if (new Date(isoEndsAt).getTime() <= new Date(isoStartsAt).getTime()) {
      setFormError('End time must be after start time.');
      return;
    }

    let expectedNum = 0;
    if (editExpected.trim()) {
      expectedNum = parseInt(editExpected.trim(), 10);
      if (isNaN(expectedNum) || expectedNum < 0) {
        setFormError('Expected attendees must be a valid positive number.');
        return;
      }
    }

    const academicReferenceYear = Number(editAcademicReferenceYear);
    if (
      !Number.isInteger(academicReferenceYear) ||
      academicReferenceYear < 1900 ||
      academicReferenceYear > 9999
    ) {
      setFormError('Academic reference year must contain a valid four-digit year.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await updateEvent({
        id: event.id,
        name: editName.trim(),
        venue: editVenue.trim(),
        startsAt: isoStartsAt,
        endsAt: isoEndsAt,
        academicReferenceYear,
        status: editStatus,
        expectedAttendees: expectedNum,
      });

      setEditModalOpen(false);
      void reload();
    } catch {
      setFormError('An error occurred while updating the event.');
    } finally {
      setSubmitting(false);
    }
  }, [
    editAcademicReferenceYear,
    editDate,
    editEndTime,
    editExpected,
    editName,
    editStatus,
    editTime,
    editVenue,
    event,
    reload,
    submitting,
  ]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!event || submitting) return;
    setSubmitting(true);
    try {
      const deleted = await deleteEvent(event.id);
      if (deleted) {
        setDeleteConfirmOpen(false);
        router.back();
      } else {
        setFormError('Failed to delete event.');
      }
    } catch {
      setFormError('An error occurred while deleting the event.');
    } finally {
      setSubmitting(false);
    }
  }, [event, submitting]);

  const capacityRatio = useMemo(() => {
    if (!event || !event.expectedAttendees || event.expectedAttendees <= 0) return null;
    return Math.min(100, Math.round((event.attendeeCount / event.expectedAttendees) * 100));
  }, [event]);

  if (isVolunteer) {
    return null;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Palette.accent} />
          <Text style={styles.loadingText}>Loading event details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !event) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.headerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to events"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Event Details</Text>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={Palette.dangerText} />
          <Text style={styles.errorTitle}>{error ?? 'Event not found'}</Text>
          <Text style={styles.errorSubtitle}>
            This event may have been removed or does not exist locally.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backActionBtn, pressed && styles.pressed]}>
            <Text style={styles.backActionBtnText}>Back to Events</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isEventActive = event.status === 'active';
  const isEventDraft = event.status === 'draft';

  const dotStyle = isEventActive
    ? styles.statusDotActive
    : isEventDraft
      ? styles.statusDotDraft
      : styles.statusDotEnded;

  const pillStyle = isEventActive
    ? styles.statusPillActive
    : isEventDraft
      ? styles.statusPillDraft
      : styles.statusPillEnded;

  const pillTextStyle = isEventActive
    ? styles.statusPillTextActive
    : isEventDraft
      ? styles.statusPillTextDraft
      : styles.statusPillTextEnded;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <HotToast toast={toast} onDismiss={() => setToast(null)} />
      {/* HEADER BAR */}
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to events"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event.name}
        </Text>
        <View style={styles.headerRightActions}>
          {/* SYNC & GOOGLE DRIVE EXPORT BUTTON */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sync event attendance and update Google Drive CSV`}
            disabled={syncing}
            onPress={async () => {
              if (syncing || !event) return;
              setSyncing(true);
              try {
                const res = await processSyncQueue(event.id);
                setToast({
                  type: 'success',
                  title: 'Sync Complete',
                  message: `Synced event attendance with Google Drive & cloud (${res.successCount} local records processed).`,
                });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Sync encountered an issue.';
                if (message.includes('offline') || message.includes('Cannot sync offline')) {
                  setToast({
                    type: 'offline',
                    title: 'Cannot Sync Offline',
                    message: 'Connect to Wi-Fi or mobile data to sync attendance data.',
                  });
                } else if (message.includes('revoked')) {
                  setToast({
                    type: 'error',
                    title: 'Access Revoked',
                    message: 'Operator access has been revoked.',
                  });
                } else {
                  setToast({
                    type: 'error',
                    title: 'Sync Notice',
                    message,
                  });
                }
              } finally {
                setSyncing(false);
                void reload();
              }
            }}
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}>
            <View>
              <Ionicons
                name={syncing ? 'sync' : 'cloud-upload-outline'}
                size={20}
                color={pendingSyncCount > 0 ? Palette.successText : Palette.text}
              />
              {pendingSyncCount > 0 && !syncing && (
                <View style={styles.syncBadge}>
                  <Text style={styles.syncBadgeText}>
                    {pendingSyncCount > 99 ? '99+' : pendingSyncCount}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
          {!isVolunteer && (
            <>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit event"
                onPress={openEditModal}
                style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}>
                <Ionicons name="create-outline" size={20} color={Palette.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                onPress={() => setDeleteConfirmOpen(true)}
                style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}>
                <Ionicons name="trash-outline" size={20} color={Palette.dangerText} />
              </Pressable>
            </>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* EVENT HERO CARD */}
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleGroup}>
              <View style={[styles.statusDot, dotStyle]} />
              <Text style={styles.heroTitle}>{event.name}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Toggle status, currently ${event.status}`}
              onPress={() => void handleToggleStatus()}
              style={({ pressed }) => [styles.statusPill, pillStyle, pressed && styles.pressed]}>
              <Text style={[styles.statusPillText, pillTextStyle]}>
                {formatEventStatus(event.status)}
              </Text>
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={16} color={Palette.textSecondary} />
              <Text style={styles.metaText}>{event.venue}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={16} color={Palette.textSecondary} />
              <Text style={styles.metaText}>{formatEventTimeRange(event.startsAt, event.endsAt)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="school-outline" size={16} color={Palette.textSecondary} />
              <Text style={styles.metaText}>
                AY {event.academicReferenceYear}–{event.academicReferenceYear + 1}
              </Text>
            </View>
          </View>

          {/* CAPACITY PROGRESS */}
          <View style={styles.capacitySection}>
            <View style={styles.capacityHeader}>
              <Text style={styles.capacityLabel}>ATTENDEE CAPACITY</Text>
              <Text style={styles.capacityValue}>
                {event.attendeeCount} / {event.expectedAttendees || '∞'}
              </Text>
            </View>
            {capacityRatio !== null && (
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${capacityRatio}%`,
                      backgroundColor:
                        capacityRatio >= 90
                          ? Palette.dangerText
                          : capacityRatio >= 60
                            ? Palette.accent
                            : Palette.successText,
                    },
                  ]}
                />
              </View>
            )}
          </View>

          {/* QUICK ACTION BUTTONS */}
          <View style={styles.actionButtonsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan for this event"
              onPress={() => {
                void setPreference(SELECTED_EVENT_KEY, eventId);
                router.push('/(tabs)/scan');
              }}
              style={({ pressed }) => [styles.primaryScanBtn, pressed && styles.pressed]}>
              <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryScanBtnText}>Open Scanner</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit event details"
              onPress={openEditModal}
              style={({ pressed }) => [styles.secondaryActionBtn, pressed && styles.pressed]}>
              <Ionicons name="pencil-outline" size={18} color={Palette.text} />
              <Text style={styles.secondaryActionBtnText}>Edit Details</Text>
            </Pressable>
          </View>
        </View>

        {/* EVENT ANALYTICS CHARTS */}
        <View style={styles.sectionContainer}>
          <EventChartsOverview event={event} history={history} />
        </View>

        {/* ATTENDANCE RECORDS FOR THIS EVENT */}
        <View style={styles.sectionContainer}>
          <HistorySection
            items={history}
            events={[event]}
            onChanged={() => void reload()}
          />
        </View>
      </ScrollView>

      {/* EDIT EVENT MODAL */}
      <Modal
        visible={editModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Event</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditModalOpen(false)}
                style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}>
                <Ionicons name="close" size={20} color={Palette.textSecondary} />
              </Pressable>
            </View>

            {Boolean(formError) && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Palette.dangerText} />
                <Text style={styles.errorBoxText}>{formError}</Text>
              </View>
            )}

            <ScrollView contentContainerStyle={styles.formScroll}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>EVENT NAME</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="e.g. Annual Tech Summit 2026"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.textInput}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>VENUE</Text>
                <TextInput
                  value={editVenue}
                  onChangeText={setEditVenue}
                  placeholder="e.g. Main Auditorium, Building A"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.textInput}
                />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>DATE</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDatePickerOpen(true)}
                    style={styles.pickerTriggerBtn}>
                    <Ionicons name="calendar-outline" size={16} color={Palette.textSecondary} />
                    <Text style={styles.pickerTriggerText}>{editDate || 'Select Date'}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.formRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>START TIME</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setTimePickerOpen(true)}
                    style={styles.pickerTriggerBtn}>
                    <Ionicons name="time-outline" size={16} color={Palette.textSecondary} />
                    <Text style={styles.pickerTriggerText}>{editTime || 'Select Start Time'}</Text>
                  </Pressable>
                </View>

                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>END TIME</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEndTimePickerOpen(true)}
                    style={styles.pickerTriggerBtn}>
                    <Ionicons name="time-outline" size={16} color={Palette.textSecondary} />
                    <Text style={styles.pickerTriggerText}>{editEndTime || 'Select End Time'}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>ACADEMIC REFERENCE YEAR</Text>
                <TextInput
                  value={editAcademicReferenceYear}
                  onChangeText={setEditAcademicReferenceYear}
                  keyboardType="numeric"
                  maxLength={4}
                  placeholder="e.g. 2026"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.textInput}
                />
                <Text style={styles.fieldHint}>
                  IDs beginning with this year are classified as 1st year. Changes affect future
                  scans only.
                </Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>EXPECTED ATTENDEES</Text>
                <TextInput
                  value={editExpected}
                  onChangeText={setEditExpected}
                  keyboardType="numeric"
                  placeholder="e.g. 150"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.textInput}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>STATUS</Text>
                <View style={styles.statusOptionsRow}>
                  {(['active', 'draft', 'completed'] as EventStatus[]).map((st) => {
                    const selected = editStatus === st;
                    return (
                      <Pressable
                        key={st}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setEditStatus(st)}
                        style={({ pressed }) => [
                          styles.statusOptionBtn,
                          selected && styles.statusOptionBtnSelected,
                          pressed && styles.pressed,
                        ]}>
                        <Text
                          style={[
                            styles.statusOptionText,
                            selected && styles.statusOptionTextSelected,
                          ]}>
                          {formatEventStatus(st)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditModalOpen(false)}
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleSaveEdit()}
                  disabled={submitting}
                  style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
                  {submitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Changes</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DATE & TIME PICKERS */}
      <DatePickerModal
        visible={datePickerOpen}
        value={editDate}
        onSelect={(val) => {
          setEditDate(val);
          setDatePickerOpen(false);
        }}
        onClose={() => setDatePickerOpen(false)}
      />
      <TimePickerModal
        visible={timePickerOpen}
        value={editTime}
        onSelect={(val) => {
          setEditTime(val);
          setTimePickerOpen(false);
        }}
        onClose={() => setTimePickerOpen(false)}
      />
      <TimePickerModal
        visible={endTimePickerOpen}
        value={editEndTime}
        onSelect={(val) => {
          setEditEndTime(val);
          setEndTimePickerOpen(false);
        }}
        onClose={() => setEndTimePickerOpen(false)}
      />

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        visible={deleteConfirmOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setDeleteConfirmOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.deleteModalCard}>
            <View style={styles.deleteIconCircle}>
              <Ionicons name="trash" size={28} color={Palette.dangerText} />
            </View>
            <Text style={styles.deleteTitle}>Delete Event?</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to delete &quot;{event.name}&quot;? This action will remove the event and
              cannot be undone.
            </Text>
            <View style={styles.deleteModalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDeleteConfirmOpen(false)}
                style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleDeleteConfirm()}
                disabled={submitting}
                style={({ pressed }) => [styles.deleteConfirmBtn, pressed && styles.pressed]}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.deleteConfirmBtnText}>Delete Event</Text>
                )}
              </Pressable>
            </View>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  headerBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
    backgroundColor: Palette.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBadge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Palette.successText,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  syncBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 60,
  },
  heroCard: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    gap: 16,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: Palette.text,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotActive: { backgroundColor: Palette.successText },
  statusDotDraft: { backgroundColor: '#F59E0B' },
  statusDotEnded: { backgroundColor: Palette.textMuted },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusPillActive: { backgroundColor: Palette.successSoft, borderColor: Palette.successText },
  statusPillDraft: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  statusPillEnded: { backgroundColor: Palette.borderLight, borderColor: Palette.textMuted },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusPillTextActive: { color: Palette.successText },
  statusPillTextDraft: { color: '#B45309' },
  statusPillTextEnded: { color: Palette.textSecondary },
  metaRow: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    gap: 15,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  capacitySection: {
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Palette.borderLight,
  },
  capacityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  capacityLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.textMuted,
    letterSpacing: 0.5,
  },
  capacityValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: Palette.borderLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  primaryScanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.accent,
    borderRadius: 12,
    paddingVertical: 12,
  },
  primaryScanBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.text,
  },
  sectionContainer: {
    marginTop: 4,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  errorSubtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  backActionBtn: {
    marginTop: 12,
    backgroundColor: Palette.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  backActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.7,
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: Palette.surface,
    borderRadius: 20,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formScroll: {
    padding: 16,
    gap: 14,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.dangerSoft,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
  },
  errorBoxText: {
    fontSize: 13,
    color: Palette.dangerText,
    flex: 1,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.textMuted,
    letterSpacing: 0.5,
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textSecondary,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pickerTriggerBtn: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: Palette.background,
  },
  pickerTriggerText: {
    fontSize: 14,
    color: Palette.text,
  },
  statusOptionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusOptionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    backgroundColor: Palette.background,
  },
  statusOptionBtnSelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.borderLight,
  },
  statusOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  statusOptionTextSelected: {
    color: Palette.accent,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 10,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.accent,
    borderRadius: 10,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  deleteModalCard: {
    backgroundColor: Palette.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  deleteIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Palette.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  deleteMessage: {
    fontSize: 14,
    color: Palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  deleteConfirmBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.dangerText,
    borderRadius: 10,
  },
  deleteConfirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

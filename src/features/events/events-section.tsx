import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
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

import { DatePickerModal } from '@/components/date-picker-modal';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Palette } from '@/constants/palette';
import { SELECTED_EVENT_KEY, setPreference } from '@/lib/preferences';
import {
  createEvent,
  deleteEvent,
  toggleEventStatus,
  updateEvent,
} from '@/features/events/event-repository';
import type { EventStatus, LocalEvent } from '@/features/events/event-types';
import { formatEventStatus, formatEventTimeRange } from '@/features/events/formatters';
import { useAuth } from '@/features/auth/auth-context';

function getInitialDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getInitialAcademicReferenceYear(): string {
  return String(new Date().getFullYear());
}

function getInitialTime(): string {
  const date = new Date();
  let hours = date.getHours();
  const isPm = hours >= 12;
  hours = hours % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = isPm ? 'PM' : 'AM';
  return `${hours.toString().padStart(2, '0')}:${minutes} ${period}`;
}

function getInitialEndTime(): string {
  const date = new Date();
  date.setHours(date.getHours() + 4);
  let hours = date.getHours();
  const isPm = hours >= 12;
  hours = hours % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = isPm ? 'PM' : 'AM';
  return `${hours.toString().padStart(2, '0')}:${minutes} ${period}`;
}

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

type EventsSectionProps = {
  events: LocalEvent[];
  onEventCreated: () => void;
};

/**
 * EventsSection — Primary UI feature section for event management.
 *
 * Core Features:
 * - Status Filter Tabs: All, Active, Draft, and Ended ('completed').
 * - 3-State Status Toggle: Cycles status (active -> draft -> completed -> active).
 * - Tapping an event card navigates directly to its dedicated subpage (/events/[id]).
 * - Custom Apple-style minimal DatePickerModal & TimePickerModal integration.
 * - Full Event Creation, Editing, and Idempotent Local Deletion with outbox sync.
 */
export function EventsSection({ events, onEventCreated }: EventsSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState(getInitialDate);
  const [time, setTime] = useState(getInitialTime);
  const [endTime, setEndTime] = useState(getInitialEndTime);
  const [academicReferenceYear, setAcademicReferenceYear] = useState(
    getInitialAcademicReferenceYear,
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [endTimePickerOpen, setEndTimePickerOpen] = useState(false);
  const [expectedAttendees, setExpectedAttendees] = useState('');
  const [status, setStatus] = useState<EventStatus>('active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingEvent, setEditingEvent] = useState<LocalEvent | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'completed'>('all');
  const EVENTS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const { user, localUser, role: userRole, assignedEventId } = useAuth();
  const effectiveUserEmail = (localUser?.email || user?.email || '').toLowerCase();

  const scopedEvents = useMemo(() => {
    if (userRole === 'Superadmin') {
      return events;
    }
    if (userRole === 'Organizer') {
      return events.filter(
        (e) =>
          (e.createdBy && e.createdBy.toLowerCase() === effectiveUserEmail) ||
          e.id === assignedEventId,
      );
    }
    if (userRole === 'Volunteer') {
      return events.filter((e) => e.id === assignedEventId);
    }
    return events;
  }, [events, userRole, effectiveUserEmail, assignedEventId]);

  const activeCount = useMemo(() => scopedEvents.filter((e) => e.status === 'active').length, [scopedEvents]);
  const draftCount = useMemo(() => scopedEvents.filter((e) => e.status === 'draft').length, [scopedEvents]);
  const endedCount = useMemo(() => scopedEvents.filter((e) => e.status === 'completed').length, [scopedEvents]);

  const filteredEvents = useMemo(() => {
    if (statusFilter === 'all') return scopedEvents;
    return scopedEvents.filter((e) => e.status === statusFilter);
  }, [scopedEvents, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PER_PAGE));
  const validPage = Math.min(currentPage, totalPages);

  const paginatedEvents = useMemo(() => {
    const start = (validPage - 1) * EVENTS_PER_PAGE;
    return filteredEvents.slice(start, start + EVENTS_PER_PAGE);
  }, [filteredEvents, validPage]);

  const inputStyle = useMemo(() => [styles.input], []);

  const resetForm = useCallback(() => {
    setName('');
    setVenue('');
    setExpectedAttendees('');
    setAcademicReferenceYear(getInitialAcademicReferenceYear());
    setStatus('active');
    setError(null);
    setEditingEvent(null);
    setDeleteConfirming(false);
  }, []);

  const openCreateForm = useCallback(() => {
    resetForm();
    setDate(getInitialDate());
    setTime(getInitialTime());
    setEndTime(getInitialEndTime());
    setFormOpen(true);
  }, [resetForm]);

  const openEditForm = useCallback((event: LocalEvent, e?: any) => {
    e?.stopPropagation();
    setEditingEvent(event);
    setName(event.name);
    setVenue(event.venue);
    setExpectedAttendees(event.expectedAttendees ? String(event.expectedAttendees) : '');
    setAcademicReferenceYear(String(event.academicReferenceYear));
    setStatus(event.status);

    const d = new Date(event.startsAt);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      setDate(`${year}-${month}-${day}`);

      let hours = d.getHours();
      const isPm = hours >= 12;
      hours = hours % 12 || 12;
      const minutes = d.getMinutes().toString().padStart(2, '0');
      setTime(`${hours.toString().padStart(2, '0')}:${minutes} ${isPm ? 'PM' : 'AM'}`);
    }

    const dEnd = event.endsAt
      ? new Date(event.endsAt)
      : new Date(new Date(event.startsAt).getTime() + 4 * 60 * 60 * 1000);
    if (!isNaN(dEnd.getTime())) {
      let hoursEnd = dEnd.getHours();
      const isPmEnd = hoursEnd >= 12;
      hoursEnd = hoursEnd % 12 || 12;
      const minutesEnd = dEnd.getMinutes().toString().padStart(2, '0');
      setEndTime(`${hoursEnd.toString().padStart(2, '0')}:${minutesEnd} ${isPmEnd ? 'PM' : 'AM'}`);
    }

    setError(null);
    setDeleteConfirming(false);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    if (submitting) return;
    setFormOpen(false);
    resetForm();
  }, [resetForm, submitting]);

  const handleSave = useCallback(async () => {
    const startsAt = parseLocalDateTime(date.trim(), time.trim());
    const parsedEndsAt = parseLocalDateTime(date.trim(), endTime.trim());
    const fallbackEndsAt = startsAt
      ? new Date(new Date(startsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();
    const endsAt = parsedEndsAt ?? fallbackEndsAt;
    const expected = expectedAttendees.trim() ? Number(expectedAttendees) : 0;
    const referenceYear = Number(academicReferenceYear);

    if (name.trim().length < 3) {
      setError('Event name must contain at least 3 characters.');
      return;
    }
    if (!startsAt) {
      setError('Use a valid start date and time (e.g. 09:30 AM).');
      return;
    }
    if (!parsedEndsAt) {
      setError('Use a valid end time (e.g. 05:00 PM).');
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('End time must be after start time.');
      return;
    }
    if (!Number.isInteger(expected) || expected < 0) {
      setError('Expected attendees must be a whole number.');
      return;
    }
    if (!Number.isInteger(referenceYear) || referenceYear < 1900 || referenceYear > 9999) {
      setError('Academic reference year must contain a valid four-digit year.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (editingEvent) {
        await updateEvent({
          id: editingEvent.id,
          name,
          venue,
          startsAt,
          endsAt,
          academicReferenceYear: referenceYear,
          status,
          expectedAttendees: expected,
        });
      } else {
        await createEvent({
          name,
          venue,
          startsAt,
          endsAt,
          academicReferenceYear: referenceYear,
          status,
          expectedAttendees: expected,
          createdBy: effectiveUserEmail,
        });
      }
      closeForm();
      onEventCreated();
    } catch {
      setError('The event could not be saved locally.');
    } finally {
      setSubmitting(false);
    }
  }, [
    academicReferenceYear,
    closeForm,
    date,
    editingEvent,
    endTime,
    expectedAttendees,
    name,
    onEventCreated,
    status,
    time,
    effectiveUserEmail,
    venue,
  ]);

  const handleToggleStatus = useCallback(
    async (event: LocalEvent, e?: any) => {
      e?.stopPropagation();
      const nextStatus: EventStatus =
        event.status === 'active'
          ? 'draft'
          : event.status === 'draft'
            ? 'completed'
            : 'active';
      try {
        await toggleEventStatus(event.id, nextStatus);
        onEventCreated();
      } catch {
        // ignore error
      }
    },
    [onEventCreated],
  );

  const handleDeleteEvent = useCallback(async () => {
    if (!editingEvent) return;
    setSubmitting(true);
    try {
      await deleteEvent(editingEvent.id);
      closeForm();
      onEventCreated();
    } catch {
      setError('The event could not be deleted.');
    } finally {
      setSubmitting(false);
    }
  }, [closeForm, editingEvent, onEventCreated]);

  return (
    <View style={styles.section}>
      {/* SECTION HEADER */}
      <View style={styles.sectionHeader}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.sectionTitle}>Events</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{events.length} total</Text>
          </View>
        </View>

        {userRole !== 'Volunteer' && (
          <Pressable
            accessibilityRole="button"
            onPress={openCreateForm}
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
            <Ionicons name="add-circle" size={18} color="#FFFFFF" />
            <Text style={styles.newButtonText}>Create Event</Text>
          </Pressable>
        )}

      </View>

      {/* STATUS FILTER SECTIONS / TABS (ALL, ACTIVE, DRAFT, ENDED) */}
      <View style={styles.statusTabsRow}>
        {[
          { key: 'all', label: 'All', count: events.length },
          { key: 'active', label: 'Active', count: activeCount },
          { key: 'draft', label: 'Draft', count: draftCount },
          { key: 'completed', label: 'Ended', count: endedCount },
        ].map((tab) => {
          const selected = statusFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                setStatusFilter(tab.key as any);
                setCurrentPage(1);
              }}
              style={({ pressed }) => [
                styles.statusTabBtn,
                selected && styles.statusTabBtnSelected,
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.statusTabText,
                  selected && styles.statusTabTextSelected,
                ]}>
                {tab.label}
              </Text>
              <View
                style={[
                  styles.statusTabBadge,
                  selected && styles.statusTabBadgeSelected,
                ]}>
                <Text
                  style={[
                    styles.statusTabBadgeText,
                    selected && styles.statusTabBadgeTextSelected,
                  ]}>
                  {tab.count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* EVENTS LIST */}
      {filteredEvents.length === 0 ? (
        <View style={styles.emptyStateCard}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="calendar-outline" size={32} color={Palette.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>
            {statusFilter === 'all' ? 'No Events Created' : `No ${formatEventStatus(statusFilter)} Events`}
          </Text>
          <Text style={styles.emptyDetail}>
            {statusFilter === 'all'
              ? 'Create your first event to start capturing attendee scans with the scanner.'
              : `Events with '${formatEventStatus(statusFilter)}' status will appear in this section.`}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openCreateForm}
            style={({ pressed }) => [styles.emptyActionButton, pressed && styles.pressed]}>
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.emptyActionText}>Create Event</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.cardsContainer}>
          {paginatedEvents.map((event) => {
            const isEventActive = event.status === 'active';
            const isEventDraft = event.status === 'draft';
            const capacityRatio =
              event.expectedAttendees && event.expectedAttendees > 0
                ? Math.min(
                  100,
                  Math.round((event.attendeeCount / event.expectedAttendees) * 100),
                )
                : null;

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
              <Pressable
                key={event.id}
                accessibilityRole="button"
                accessibilityLabel={`Open details for ${event.name}`}
                onPress={() => router.push(`/events/${event.id}` as Href)}
                style={({ pressed }) => [
                  styles.eventWhiteCard,
                  pressed && styles.pressed,
                ]}>

                {/* CARD HEADER */}
                <View style={styles.cardHeaderRow}>
                  <View style={styles.titleWithStatus}>
                    <View style={[styles.statusDot, dotStyle]} />
                    <Text style={styles.eventName} numberOfLines={1}>
                      {event.name}
                    </Text>
                  </View>

                  <View style={styles.badgeRow}>
                    {/* Interactive Status Toggle */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle status, currently ${event.status}`}
                      onPress={(e) => void handleToggleStatus(event, e)}
                      style={({ pressed }) => [
                        styles.statusPill,
                        pillStyle,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={[styles.statusPillText, pillTextStyle]}>
                        {formatEventStatus(event.status)}
                      </Text>
                    </Pressable>

                    {/* Open Scanner Button */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open scanner for ${event.name}`}
                      onPress={(e) => {
                        e?.stopPropagation();
                        void setPreference(SELECTED_EVENT_KEY, event.id);
                        router.push('/(tabs)/scan');
                      }}
                      style={({ pressed }) => [styles.iconActionBtn, pressed && styles.pressed]}>
                      <Ionicons name="qr-code-outline" size={17} color="#0284C7" />
                    </Pressable>

                    {/* Edit Event Button */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit event"
                      onPress={(e) => openEditForm(event, e)}
                      style={({ pressed }) => [styles.iconActionBtn, pressed && styles.pressed]}>
                      <Ionicons name="create-outline" size={17} color={Palette.textSecondary} />
                    </Pressable>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={Palette.textMuted}
                    />
                  </View>
                </View>

                {/* META DETAILS */}
                <View style={styles.metaRowGroup}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={13} color={Palette.textSecondary} />
                    <Text style={styles.metaText}>{formatEventTimeRange(event.startsAt, event.endsAt)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="school-outline" size={13} color={Palette.textSecondary} />
                    <Text style={styles.metaText}>
                      AY {event.academicReferenceYear}–{event.academicReferenceYear + 1}
                    </Text>
                  </View>
                  {Boolean(event.venue) && (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={13} color={Palette.textSecondary} />
                      <Text style={styles.metaText} numberOfLines={1}>
                        {event.venue}
                      </Text>
                    </View>
                  )}
                </View>

                {/* ATTENDANCE PROGRESS */}
                <View style={styles.attendanceGroup}>
                  <View style={styles.attendanceValRow}>
                    <Text style={styles.attendanceCountText}>
                      <Text style={styles.attendanceBigVal}>{event.attendeeCount}</Text>
                      {event.expectedAttendees
                        ? ` / ${event.expectedAttendees} expected`
                        : ' checked in'}
                    </Text>
                    {capacityRatio !== null && (
                      <Text style={styles.capacityPctText}>{capacityRatio}%</Text>
                    )}
                  </View>
                  {capacityRatio !== null && (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${capacityRatio}%` },
                          isEventActive ? styles.progressFillActive : styles.progressFillDraft,
                        ]}
                      />
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* PAGINATION FOR EVENTS */}
      {filteredEvents.length > EVENTS_PER_PAGE && (
        <View style={styles.paginationRow}>
          <Text style={styles.paginationInfoText}>
            Showing {(validPage - 1) * EVENTS_PER_PAGE + 1}–
            {Math.min(validPage * EVENTS_PER_PAGE, filteredEvents.length)} of {filteredEvents.length} events
          </Text>

          <View style={styles.paginationControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous page"
              disabled={validPage <= 1}
              onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
              style={({ pressed }) => [
                styles.pageBtn,
                validPage <= 1 && styles.pageBtnDisabled,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name="chevron-back"
                size={16}
                color={validPage <= 1 ? Palette.textFaint : Palette.text}
              />
              <Text
                style={[
                  styles.pageBtnText,
                  validPage <= 1 && styles.pageBtnTextDisabled,
                ]}>
                Prev
              </Text>
            </Pressable>

            <View style={styles.pageBadge}>
              <Text style={styles.pageBadgeText}>
                {validPage} / {totalPages}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next page"
              disabled={validPage >= totalPages}
              onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              style={({ pressed }) => [
                styles.pageBtn,
                validPage >= totalPages && styles.pageBtnDisabled,
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.pageBtnText,
                  validPage >= totalPages && styles.pageBtnTextDisabled,
                ]}>
                Next
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={validPage >= totalPages ? Palette.textFaint : Palette.text}
              />
            </Pressable>
          </View>
        </View>
      )}

      {/* CREATE EVENT MODAL */}
      <Modal
        animationType="fade"
        transparent
        visible={formOpen}
        onRequestClose={closeForm}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {editingEvent ? 'Edit Event' : 'Create Event'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingEvent
                    ? 'Update event configuration or status.'
                    : 'Configure an attendance event destination.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={closeForm}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <Ionicons name="close" size={20} color={Palette.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}>
              <Text style={styles.fieldLabel}>Event name</Text>
              <TextInput
                accessibilityLabel="Event name"
                autoCapitalize="words"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Regional Student Summit"
                placeholderTextColor={Palette.textFaint}
                style={inputStyle}
              />

              <Text style={styles.fieldLabel}>Venue</Text>
              <TextInput
                accessibilityLabel="Event venue"
                autoCapitalize="words"
                value={venue}
                onChangeText={setVenue}
                placeholder="e.g. Main Auditorium"
                placeholderTextColor={Palette.textFaint}
                style={inputStyle}
              />

              <View style={styles.fieldRow}>
                <View style={styles.compactField}>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select event date"
                    onPress={() => setDatePickerOpen(true)}
                    style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pressed]}>
                    <Ionicons name="calendar-outline" size={16} color={Palette.textSecondary} />
                    <Text style={date ? styles.pickerTriggerValue : styles.pickerTriggerPlaceholder}>
                      {date || 'YYYY-MM-DD'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.compactField}>
                  <Text style={styles.fieldLabel}>Start Time</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select event start time"
                    onPress={() => setTimePickerOpen(true)}
                    style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pressed]}>
                    <Ionicons name="time-outline" size={16} color={Palette.textSecondary} />
                    <Text style={time ? styles.pickerTriggerValue : styles.pickerTriggerPlaceholder}>
                      {time || 'Start Time'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.compactField}>
                  <Text style={styles.fieldLabel}>End Time</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select event end time"
                    onPress={() => setEndTimePickerOpen(true)}
                    style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pressed]}>
                    <Ionicons name="time-outline" size={16} color={Palette.textSecondary} />
                    <Text style={endTime ? styles.pickerTriggerValue : styles.pickerTriggerPlaceholder}>
                      {endTime || 'End Time'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Academic reference year</Text>
              <TextInput
                accessibilityLabel="Academic reference year"
                value={academicReferenceYear}
                onChangeText={setAcademicReferenceYear}
                placeholder="e.g. 2026"
                placeholderTextColor={Palette.textFaint}
                inputMode="numeric"
                maxLength={4}
                style={inputStyle}
              />
              <Text style={styles.hint}>
                Students whose IDs begin with this year are classified as 1st year.
                {editingEvent ? ' Changes affect future scans only.' : ''}
              </Text>

              <Text style={styles.fieldLabel}>Expected attendees</Text>
              <TextInput
                accessibilityLabel="Expected attendee count"
                value={expectedAttendees}
                onChangeText={setExpectedAttendees}
                placeholder="Optional target capacity"
                placeholderTextColor={Palette.textFaint}
                inputMode="numeric"
                style={inputStyle}
              />

              <Text style={styles.fieldLabel}>Event status</Text>
              <View style={styles.statusOptions}>
                {(['active', 'draft', 'completed'] as const).map((option) => {
                  const isOptionSelected = status === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isOptionSelected }}
                      onPress={() => setStatus(option)}
                      style={({ pressed }) => [
                        styles.statusOption,
                        isOptionSelected && styles.statusOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Ionicons
                        name={isOptionSelected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={16}
                        color={isOptionSelected ? Palette.successText : Palette.textSecondary}
                      />
                      <Text
                        style={[
                          styles.statusOptionText,
                          isOptionSelected && styles.statusOptionTextSelected,
                        ]}>
                        {formatEventStatus(option)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Active events appear immediately in the QR scanner destination selector.
              </Text>

              {error && (
                <View style={styles.errorPanel}>
                  <Ionicons name="alert-circle-outline" size={16} color={Palette.dangerText} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => void handleSave()}
                style={({ pressed }) => [
                  styles.submitButton,
                  submitting && styles.submitButtonDisabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.submitButtonText}>
                  {submitting
                    ? 'Saving...'
                    : editingEvent
                      ? 'Save Changes'
                      : 'Create Event'}
                </Text>
              </Pressable>

              {/* DELETE EVENT OPTION WHEN EDITING */}
              {editingEvent && (
                <View style={styles.deleteSection}>
                  {deleteConfirming ? (
                    <View style={styles.deleteConfirmBox}>
                      <Text style={styles.deleteConfirmText}>
                        Delete this event and its local attendance records?
                      </Text>
                      <View style={styles.deleteConfirmButtons}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setDeleteConfirming(false)}
                          style={({ pressed }) => [styles.deleteCancelBtn, pressed && styles.pressed]}>
                          <Text style={styles.deleteCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={submitting}
                          onPress={() => void handleDeleteEvent()}
                          style={({ pressed }) => [styles.deleteConfirmBtn, pressed && styles.pressed]}>
                          <Ionicons name="trash" size={14} color="#FFFFFF" />
                          <Text style={styles.deleteConfirmBtnText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setDeleteConfirming(true)}
                      style={({ pressed }) => [styles.deleteTriggerBtn, pressed && styles.pressed]}>
                      <Ionicons name="trash-outline" size={16} color={Palette.dangerText} />
                      <Text style={styles.deleteTriggerText}>Delete Event</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DATE PICKER */}
      <DatePickerModal
        visible={datePickerOpen}
        value={date}
        onSelect={setDate}
        onClose={() => setDatePickerOpen(false)}
      />

      {/* START TIME PICKER */}
      <TimePickerModal
        visible={timePickerOpen}
        value={time}
        onSelect={setTime}
        onClose={() => setTimePickerOpen(false)}
      />

      {/* END TIME PICKER */}
      <TimePickerModal
        visible={endTimePickerOpen}
        value={endTime}
        onSelect={setEndTime}
        onClose={() => setEndTimePickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 20,
    marginTop: 24,
    gap: 16,
  },

  /* SECTION HEADER */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Palette.text,
    letterSpacing: -0.3,
  },
  countBadge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: Palette.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  newButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* EMPTY STATE */
  emptyStateCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  emptyDetail: {
    marginTop: 4,
    fontSize: 13,
    color: Palette.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* EVENTS LIST CARDS */
  cardsContainer: {
    gap: 14,
  },
  eventWhiteCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  eventWhiteCardSelected: {
    borderColor: Palette.success,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleWithStatus: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  /* STATUS CATEGORY TABS */
  statusTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 14,
  },
  statusTabBtn: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  statusTabBtnSelected: {
    backgroundColor: Palette.text,
    borderColor: Palette.text,
  },
  statusTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  statusTabTextSelected: {
    color: '#FFFFFF',
  },
  statusTabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Palette.borderLight,
  },
  statusTabBadgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  statusTabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  statusTabBadgeTextSelected: {
    color: '#FFFFFF',
  },

  statusDotActive: {
    backgroundColor: Palette.success,
  },
  statusDotDraft: {
    backgroundColor: '#F59E0B',
  },
  statusDotEnded: {
    backgroundColor: '#6B7280',
  },
  eventName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillActive: {
    backgroundColor: Palette.successSoft,
  },
  statusPillDraft: {
    backgroundColor: '#FEF3C7',
  },
  statusPillEnded: {
    backgroundColor: '#F3F4F6',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPillTextActive: {
    color: Palette.successText,
  },
  statusPillTextDraft: {
    color: '#D97706',
  },
  statusPillTextEnded: {
    color: '#4B5563',
  },

  /* META */
  metaRowGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: Palette.textSecondary,
    fontWeight: '500',
  },

  /* ATTENDANCE PROGRESS */
  attendanceGroup: {
    gap: 6,
    marginTop: 2,
  },
  attendanceValRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attendanceCountText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  attendanceBigVal: {
    fontSize: 15,
    fontWeight: '800',
    color: Palette.text,
  },
  capacityPctText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: Palette.borderLight,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressFillActive: {
    backgroundColor: Palette.success,
  },
  progressFillDraft: {
    backgroundColor: Palette.textMuted,
  },

  /* EMBEDDED OVERVIEW INSIDE SPECIFIC EVENT CARD */
  embeddedOverview: {
    marginTop: 6,
    gap: 14,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.border,
    marginVertical: 4,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overviewEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Palette.successText,
  },

  /* RECENT CHECK-INS */
  recentSection: {
    gap: 10,
    marginTop: 4,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  recentCountText: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  recentEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 4,
    backgroundColor: Palette.background,
    borderRadius: 12,
  },
  recentEmptyText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  recentListCard: {
    borderRadius: 12,
    backgroundColor: Palette.background,
    overflow: 'hidden',
  },
  recentRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recentRowItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.border,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Palette.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: Palette.successText,
  },
  recentCopy: {
    flex: 1,
    gap: 2,
  },
  recentName: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.text,
  },
  recentSub: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  recentMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  recentYearText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.successText,
  },
  recentTimeText: {
    fontSize: 10,
    color: Palette.textSecondary,
  },

  /* MODAL */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 12, 8, 0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    alignSelf: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 24,
    padding: 24,
    gap: 10,
  },
  modalContent: {
    gap: 10,
    paddingBottom: 2,
  },
  modalHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Palette.text,
  },
  modalSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: Palette.textSecondary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Palette.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  compactField: {
    flex: 1,
  },
  pickerTrigger: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: Palette.background,
  },
  pickerTriggerValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Palette.text,
  },
  pickerTriggerPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: Palette.textFaint,
  },
  statusOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    flex: 1,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: Palette.background,
  },
  statusOptionSelected: {
    backgroundColor: Palette.successSoft,
    borderColor: Palette.successText,
  },
  statusOptionText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  statusOptionTextSelected: {
    color: Palette.successText,
  },
  hint: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  errorPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.dangerSoft,
    backgroundColor: Palette.dangerSoft,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.dangerText,
    flex: 1,
  },
  submitButton: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.48,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  iconActionBtn: {
    padding: 4,
    borderRadius: 6,
  },
  deleteSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.border,
  },
  deleteTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.dangerSoft,
    backgroundColor: Palette.dangerSoft,
  },
  deleteTriggerText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.dangerText,
  },
  deleteConfirmBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: Palette.dangerSoft,
    gap: 10,
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.dangerText,
    textAlign: 'center',
  },
  deleteConfirmButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  deleteCancelBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  deleteCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  deleteConfirmBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: Palette.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  deleteConfirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.borderLight,
  },
  paginationInfoText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pageBtnDisabled: {
    backgroundColor: Palette.background,
    borderColor: Palette.borderLight,
    opacity: 0.5,
  },
  pageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.text,
  },
  pageBtnTextDisabled: {
    color: Palette.textFaint,
  },
  pageBadge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pageBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
});

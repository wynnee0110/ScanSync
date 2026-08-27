import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { Palette } from '@/constants/palette';
import { formatYearLevel, YEAR_LEVELS } from '@/features/attendance/year-level';
import { deleteAttendanceRecord, updateAttendanceRecord } from '@/features/events/event-repository';
import type { AttendanceHistoryItem, LocalEvent, YearLevel } from '@/features/events/event-types';
import { useAuth } from '@/features/auth/auth-context';


type Message = { tone: 'success' | 'error'; text: string };

function statusCopy(item: AttendanceHistoryItem): { label: string; tone: 'success' } {
  if (item.syncStatus === 'synced') {
    return { label: 'Attendance synced', tone: 'success' };
  }
  return { label: 'Attendance recorded', tone: 'success' };
}

type HistorySectionProps = {
  items: AttendanceHistoryItem[];
  events: LocalEvent[];
  onChanged: () => void;
};

/**
 * HistorySection — Primary attendance history list and record management feature.
 *
 * Core Features:
 * - Strict per-event view via Event Dropdown Selector Bar (no "All Events" blob).
 * - Real-time Search Bar (searches participant name, student ID, program, event).
 * - Manual Filter Modal with explicit 'Apply Filters' and 'Reset' buttons for year level & sync status.
 * - Ultra-compact record item rows with 26x26px avatar badges.
 * - Inline Record Editing modal and deletion confirmation modal with sync queue outbox updates.
 */
export function HistorySection({ items, events, onChanged }: HistorySectionProps) {
  const { user, localUser, role: userRole, assignedEventId } = useAuth();
  const isVolunteer = userRole === 'Volunteer';
  const userEmail = (localUser?.email || user?.email || '').toLowerCase();

  const scopedEvents = useMemo(() => {
    if (userRole === 'Superadmin') {
      return events;
    }
    if (userRole === 'Organizer') {
      return events.filter(
        (e) =>
          (e.createdBy && e.createdBy.toLowerCase() === userEmail) ||
          e.id === assignedEventId,
      );
    }
    if (userRole === 'Volunteer') {
      return events.filter((e) => e.id === assignedEventId);
    }
    return events;
  }, [events, userRole, userEmail, assignedEventId]);

  const scopedEventIds = useMemo(() => new Set(scopedEvents.map((e) => e.id)), [scopedEvents]);

  const scopedItems = useMemo(() => {
    if (userRole === 'Superadmin') {
      return items;
    }
    return items.filter((item) => scopedEventIds.has(item.eventId));
  }, [items, userRole, scopedEventIds]);

  const [filterEventId, setFilterEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [filterYearLevel, setFilterYearLevel] = useState<YearLevel | null>(null);
  const [filterSyncStatus, setFilterSyncStatus] = useState<'synced' | null>(null);

  // Manual Filter Modal state
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draftYearLevel, setDraftYearLevel] = useState<YearLevel | null>(null);
  const [draftSyncStatus, setDraftSyncStatus] = useState<'synced' | null>(null);

  const [editItem, setEditItem] = useState<AttendanceHistoryItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<AttendanceHistoryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editProgram, setEditProgram] = useState('');
  const [editYearLevel, setEditYearLevel] = useState<YearLevel | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // Auto-select first event if none selected (strictly by event, NO "All Events")
  useEffect(() => {
    if ((!filterEventId || !scopedEvents.some((e) => e.id === filterEventId)) && scopedEvents.length > 0) {
      setFilterEventId(scopedEvents[0].id);
    }
  }, [scopedEvents, filterEventId]);

  const openManualFilterModal = useCallback(() => {
    setDraftYearLevel(filterYearLevel);
    setDraftSyncStatus(filterSyncStatus);
    setFilterModalOpen(true);
  }, [filterYearLevel, filterSyncStatus]);

  const applyManualFilters = useCallback(() => {
    setFilterYearLevel(draftYearLevel);
    setFilterSyncStatus(draftSyncStatus);
    setFilterModalOpen(false);
  }, [draftYearLevel, draftSyncStatus]);

  const resetManualFilters = useCallback(() => {
    setDraftYearLevel(null);
    setDraftSyncStatus(null);
    setFilterYearLevel(null);
    setFilterSyncStatus(null);
    setFilterModalOpen(false);
  }, []);

  const hasActiveManualFilters = filterYearLevel !== null || filterSyncStatus !== null;
  const hasActiveFilters = hasActiveManualFilters || Boolean(searchQuery.trim());

  const filtered = useMemo(() => {
    return scopedItems.filter((item) => {
      // Must match selected event strictly
      if (filterEventId && item.eventId !== filterEventId) {
        return false;
      }
      if (filterYearLevel !== null && item.yearLevel !== filterYearLevel) {
        return false;
      }
      if (filterSyncStatus !== null && item.syncStatus !== filterSyncStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = item.participantName?.toLowerCase().includes(q) ?? false;
        const matchRef = item.participantReference.toLowerCase().includes(q);
        const matchProg = item.participantProgram?.toLowerCase().includes(q) ?? false;
        const matchEvent = item.eventName.toLowerCase().includes(q);
        return matchName || matchRef || matchProg || matchEvent;
      }
      return true;
    });
  }, [scopedItems, filterEventId, filterYearLevel, filterSyncStatus, searchQuery]);

  const HISTORY_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 when filters or selected event changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterEventId, filterYearLevel, filterSyncStatus, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PER_PAGE));
  const validPage = Math.min(currentPage, totalPages);

  const activeEvent = useMemo(() => {
    return scopedEvents.find((e) => e.id === filterEventId) || scopedEvents[0] || null;
  }, [scopedEvents, filterEventId]);

  const groupedByEvent = useMemo(() => {
    if (!activeEvent) return [];

    const start = (validPage - 1) * HISTORY_PER_PAGE;
    const targetItems = filtered.slice(start, start + HISTORY_PER_PAGE);

    return [
      {
        eventId: activeEvent.id,
        eventName: activeEvent.name,
        items: targetItems,
      },
    ];
  }, [activeEvent, filtered, validPage]);

  const openEditModal = useCallback((item: AttendanceHistoryItem) => {
    setEditItem(item);
    setEditName(item.participantName ?? '');
    setEditReference(item.participantReference);
    setEditProgram(item.participantProgram ?? '');
    setEditYearLevel(item.yearLevel);
    setEditError(null);
  }, []);


  const closeEditModal = useCallback(() => {
    if (mutating) return;
    setEditItem(null);
    setEditError(null);
  }, [mutating]);

  const handleSaveEdit = useCallback(async () => {
    if (!editItem || !editYearLevel || mutating) return;

    const participantReference = editReference.trim();
    const participantName = editName.trim().replace(/\s+/g, ' ');
    const participantProgram = editProgram.trim().replace(/\s+/g, ' ');

    const isSchoolId = editItem.qrFormat !== 'opaque';

    if (
      (isSchoolId && !/^\d{10}$/.test(participantReference)) ||
      (editItem.qrFormat === 'opaque' && participantReference.length < 6)
    ) {
      setEditError(
        isSchoolId
          ? 'Student ID must contain exactly 10 digits.'
          : 'Participant reference must contain at least 6 characters.',
      );
      return;
    }
    if (isSchoolId && participantName.length < 2) {
      setEditError('Student name must contain at least 2 characters.');
      return;
    }
    if (
      isSchoolId &&
      !/^[A-Za-z0-9 .&()+\/-]{2,32}$/.test(participantProgram)
    ) {
      setEditError('Enter a valid program code between 2 and 32 characters.');
      return;
    }

    setMutating(true);
    try {
      const result = await updateAttendanceRecord(editItem.id, {
        participantReference,
        participantName: participantName || null,
        participantProgram: participantProgram || null,
        yearLevel: editYearLevel,
      });
      if (result.status === 'duplicate') {
        setEditError('Another attendee in this event already uses that student ID.');
        return;
      }
      setEditItem(null);
      setMessage({ tone: 'success', text: 'Attendance record updated.' });
      onChanged();
    } catch {
      setEditError('The attendance record could not be updated.');
    } finally {
      setMutating(false);
    }
  }, [editItem, editName, editProgram, editReference, editYearLevel, mutating, onChanged]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteItem || mutating) return;
    setMutating(true);
    try {
      const deleted = await deleteAttendanceRecord(deleteItem.id);
      setDeleteItem(null);
      setMessage({
        tone: deleted ? 'success' : 'error',
        text: deleted
          ? 'Attendance record deleted.'
          : 'The attendance record no longer exists.',
      });
      onChanged();
    } catch {
      setMessage({ tone: 'error', text: 'The attendance record could not be deleted.' });
      setDeleteItem(null);
    } finally {
      setMutating(false);
    }
  }, [deleteItem, mutating, onChanged]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Scans</Text>
      </View>

      {/* EVENT SELECTOR CHIPS & SUBPAGE LINK */}
      {scopedEvents.length > 0 && activeEvent && (
        <View style={styles.eventHeaderBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.eventChipsScroll}>
            {scopedEvents.map((ev) => {
              const selected = ev.id === activeEvent.id;
              const count = scopedItems.filter((i) => i.eventId === ev.id).length;
              return (
                <Pressable
                  key={ev.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setFilterEventId(ev.id)}
                  style={({ pressed }) => [
                    styles.eventChip,
                    selected && styles.eventChipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[styles.eventChipText, selected && styles.eventChipTextSelected]}
                    numberOfLines={1}>
                    {ev.name}
                  </Text>
                  <View style={[styles.eventChipBadge, selected && styles.eventChipBadgeSelected]}>
                    <Text
                      style={[
                        styles.eventChipBadgeText,
                        selected && styles.eventChipBadgeTextSelected,
                      ]}>
                      {count}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {!isVolunteer && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open subpage for ${activeEvent.name}`}
              onPress={() => router.push(`/events/${activeEvent.id}` as Href)}
              style={({ pressed }) => [styles.viewEventSubpageBtn, pressed && styles.pressed]}>
              <Ionicons name="chevron-forward" size={15} color={Palette.accent} />
            </Pressable>
          )}
        </View>
      )}

      {/* SEARCH AND MANUAL FILTER BAR */}
      <View style={styles.searchAndFilterRow}>
        <View style={styles.searchBarContainer}>
          <Ionicons name="search-outline" size={18} color={Palette.textSecondary} />
          <TextInput
            accessibilityLabel="Search attendance records"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, ID, program..."
            placeholderTextColor={Palette.textFaint}
            style={styles.searchInput}
          />
          {Boolean(searchQuery) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
              onPress={() => setSearchQuery('')}
              style={({ pressed }) => [styles.searchClearBtn, pressed && styles.pressed]}>
              <Ionicons name="close-circle" size={18} color={Palette.textMuted} />
            </Pressable>
          )}
        </View>

        {/* MANUAL FILTER BUTTON */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open manual filter settings"
          onPress={openManualFilterModal}
          style={({ pressed }) => [
            styles.manualFilterBtn,
            hasActiveManualFilters && styles.manualFilterBtnActive,
            pressed && styles.pressed,
          ]}>
          <Ionicons
            name="options-outline"
            size={18}
            color={hasActiveManualFilters ? '#FFFFFF' : Palette.text}
          />
          <Text
            style={[
              styles.manualFilterBtnText,
              hasActiveManualFilters && styles.manualFilterBtnTextActive,
            ]}>
            Filter
          </Text>
          {hasActiveManualFilters && <View style={styles.filterActiveDot} />}
        </Pressable>
      </View>

      {/* FILTER RESULTS SUMMARY */}
      {hasActiveFilters && (
        <View style={styles.activeFiltersRow}>
          <Text style={styles.activeFiltersText}>
            Showing {filtered.length} {filtered.length === 1 ? 'matching record' : 'matching records'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={resetManualFilters}
            style={({ pressed }) => [styles.resetFiltersBtn, pressed && styles.pressed]}>
            <Ionicons name="refresh-outline" size={14} color={Palette.textSecondary} />
            <Text style={styles.resetFiltersText}>Reset filters</Text>
          </Pressable>
        </View>
      )}

      {message && (
        <View
          style={[
            styles.messagePanel,
            message.tone === 'success' ? styles.messageSuccess : styles.messageError,
          ]}>
          <Text
            style={[
              styles.messageText,
              { color: message.tone === 'success' ? Palette.successText : Palette.dangerText },
            ]}>
            {message.text}
          </Text>
        </View>
      )}

      {filtered.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No attendance records</Text>
            <Text style={styles.emptyDetail}>
              Successful QR captures for events will appear here immediately.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.groupsContainer}>
          {groupedByEvent.map((group) => (
            <View key={group.eventId} style={styles.eventCardGroup}>
              {/* EVENT GROUP HEADER */}
              <View style={styles.eventGroupHeader}>
                <View style={styles.eventGroupTitleRow}>
                  <Ionicons name="calendar-outline" size={16} color={Palette.text} />
                  <Text style={styles.eventGroupTitle} numberOfLines={1}>
                    {group.eventName}
                  </Text>
                </View>
                <View style={styles.eventCountBadge}>
                  <Text style={styles.eventCountText}>
                    {group.items.length} {group.items.length === 1 ? 'record' : 'records'}
                  </Text>
                </View>
              </View>

              {/* LIST OF ATTENDANCE ITEMS FOR THIS EVENT */}
              <View style={styles.eventGroupList}>
                {group.items.map((item, index) => {
                  const status = statusCopy(item);
                  const iconColor = Palette.successText;
                  const iconBackground = Palette.successSoft;
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.row,
                        index !== group.items.length - 1 && styles.rowBorder,
                      ]}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openEditModal(item)}
                        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
                        <View style={[styles.iconCircle, { backgroundColor: iconBackground }]}>
                          <Ionicons name="checkmark" size={14} color={iconColor} />
                        </View>

                        <View style={styles.rowCopy}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {item.participantName ?? item.participantReference}
                          </Text>
                          <Text style={[styles.rowStatus, { color: iconColor }]} numberOfLines={1}>
                            Ref: {item.participantReference}
                            {item.participantProgram ? ` · ${item.participantProgram}` : ''}
                            {item.yearLevel ? ` · Year ${item.yearLevel}` : ''}
                          </Text>
                        </View>

                        <View style={styles.rowMeta}>
                          <Text style={styles.rowTime} numberOfLines={1}>
                            {formatShortTime(item.recordedAt)}
                          </Text>
                          <Text style={styles.rowSync}>{status.label}</Text>
                        </View>
                      </Pressable>

                        <View style={styles.rowActions}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit attendance for ${item.participantName ?? item.participantReference}`}
                            onPress={() => openEditModal(item)}
                            style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}>
                            <Text style={styles.rowActionText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Delete attendance for ${item.participantName ?? item.participantReference}`}
                            onPress={() => setDeleteItem(item)}
                            style={({ pressed }) => [
                              styles.rowAction,
                              styles.rowActionDanger,
                              pressed && styles.pressed,
                            ]}>
                            <Text style={styles.rowActionDangerText}>Delete</Text>
                          </Pressable>
                        </View>

                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* PAGINATION FOR HISTORY */}
      {filtered.length > HISTORY_PER_PAGE && (
        <View style={styles.paginationRow}>
          <Text style={styles.paginationInfoText}>
            Showing {(validPage - 1) * HISTORY_PER_PAGE + 1}–
            {Math.min(validPage * HISTORY_PER_PAGE, filtered.length)} of {filtered.length} records
          </Text>

          <View style={styles.paginationControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous history page"
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
              accessibilityLabel="Next history page"
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

      {/* EDIT MODAL */}
      <Modal animationType="fade" transparent visible={editItem !== null} onRequestClose={closeEditModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboardView}>
            <View style={styles.modalCard}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
                <Text style={styles.modalEyebrow}>EDIT ATTENDANCE</Text>
                <Text style={styles.modalTitle}>Update participant details</Text>
                <Text style={styles.modalSubtitle}>
                  Changes affect this event attendance record and its pending synchronization.
                </Text>

                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  accessibilityLabel="Participant name"
                  autoCapitalize="words"
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Participant name"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.input}
                />

                <Text style={styles.fieldLabel}>Student ID</Text>
                <TextInput
                  accessibilityLabel="Student ID"
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputMode={editItem?.qrFormat === 'school_id' ? 'numeric' : 'text'}
                  value={editReference}
                  onChangeText={setEditReference}
                  placeholder="Student ID"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.input}
                />

                <Text style={styles.fieldLabel}>Program</Text>
                <TextInput
                  accessibilityLabel="Participant program"
                  autoCapitalize="characters"
                  value={editProgram}
                  onChangeText={setEditProgram}
                  placeholder="Program code"
                  placeholderTextColor={Palette.textFaint}
                  style={styles.input}
                />

                <Text style={styles.fieldLabel}>Year level</Text>
                <View style={styles.yearOptions}>
                  {YEAR_LEVELS.map((yearLevel) => {
                    const selected = editYearLevel === yearLevel;
                    return (
                      <Pressable
                        key={yearLevel}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setEditYearLevel(yearLevel)}
                        style={({ pressed }) => [
                          styles.yearOption,
                          selected && styles.yearOptionSelected,
                          pressed && styles.pressed,
                        ]}>
                        <Text
                          style={[styles.yearOptionText, selected && styles.yearOptionTextSelected]}>
                          {formatYearLevel(yearLevel)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {editError && (
                  <View style={styles.inlineError}>
                    <Text style={styles.inlineErrorText}>{editError}</Text>
                  </View>
                )}

                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutating}
                    onPress={closeEditModal}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutating || editYearLevel === null}
                    onPress={() => void handleSaveEdit()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      (mutating || editYearLevel === null) && styles.primaryButtonDisabled,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.primaryButtonText}>
                      {mutating ? 'Saving...' : 'Save changes'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* DELETE MODAL */}
      <Modal
        animationType="fade"
        transparent
        visible={deleteItem !== null}
        onRequestClose={() => {
          if (!mutating) setDeleteItem(null);
        }}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.deleteCard]}>
            <Text style={styles.modalEyebrow}>DELETE ATTENDANCE</Text>
            <Text style={styles.modalTitle}>Delete this record?</Text>
            <Text style={styles.modalSubtitle}>
              This removes the check-in for {deleteItem?.participantName ?? 'participant'} with ID{' '}
              {deleteItem?.participantReference}. Event statistics will be updated.
            </Text>
            <Text style={styles.deleteWarning}>This action cannot be undone on this device.</Text>

            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={() => setDeleteItem(null)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>Keep record</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={() => void handleConfirmDelete()}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>
                  {mutating ? 'Deleting...' : 'Delete record'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MANUAL FILTER MODAL */}
      <Modal
        animationType="fade"
        transparent
        visible={filterModalOpen}
        onRequestClose={() => setFilterModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterModalOpen(false)}>
          <Pressable style={styles.filterModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleGroup}>
                <Text style={styles.modalTitle}>Manual Filters</Text>
                <Text style={styles.modalSubtitle}>
                  Refine attendance records by year level and sync status.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close manual filters modal"
                onPress={() => setFilterModalOpen(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <Ionicons name="close" size={20} color={Palette.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.filterModalContent}>
              {/* YEAR LEVEL SECTION */}
              <Text style={styles.fieldLabel}>Year level</Text>
              <View style={styles.filterOptionsGrid}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draftYearLevel === null }}
                  onPress={() => setDraftYearLevel(null)}
                  style={({ pressed }) => [
                    styles.filterModalOption,
                    draftYearLevel === null && styles.filterModalOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[
                      styles.filterModalOptionText,
                      draftYearLevel === null && styles.filterModalOptionTextSelected,
                    ]}>
                    All Years
                  </Text>
                </Pressable>
                {([1, 2, 3, 4] as const).map((yr) => {
                  const selected = draftYearLevel === yr;
                  return (
                    <Pressable
                      key={yr}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setDraftYearLevel(selected ? null : yr)}
                      style={({ pressed }) => [
                        styles.filterModalOption,
                        selected && styles.filterModalOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.filterModalOptionText,
                          selected && styles.filterModalOptionTextSelected,
                        ]}>
                        Year {yr}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* SYNC STATUS SECTION */}
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Sync status</Text>
              <View style={styles.filterOptionsGrid}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draftSyncStatus === null }}
                  onPress={() => setDraftSyncStatus(null)}
                  style={({ pressed }) => [
                    styles.filterModalOption,
                    draftSyncStatus === null && styles.filterModalOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[
                      styles.filterModalOptionText,
                      draftSyncStatus === null && styles.filterModalOptionTextSelected,
                    ]}>
                    All Status
                  </Text>
                </Pressable>
                {(['synced'] as const).map((st) => {
                  const selected = draftSyncStatus === st;
                  const label = 'Synced';
                  return (
                    <Pressable
                      key={st}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setDraftSyncStatus(selected ? null : st)}
                      style={({ pressed }) => [
                        styles.filterModalOption,
                        selected && styles.filterModalOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.filterModalOptionText,
                          selected && styles.filterModalOptionTextSelected,
                        ]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* MODAL ACTIONS */}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={resetManualFilters}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>Reset All</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={applyManualFilters}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>Apply Filters</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 24,
    marginTop: 24,
  },
  sectionHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventHeaderBar: {
    gap: 8,
    marginBottom: 12,
  },
  eventChipsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  eventChipSelected: {
    backgroundColor: Palette.borderLight,
    borderColor: Palette.accent,
  },
  eventChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  eventChipTextSelected: {
    color: Palette.accent,
    fontWeight: '700',
  },
  eventChipBadge: {
    backgroundColor: Palette.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  eventChipBadgeSelected: {
    backgroundColor: Palette.accent,
  },
  eventChipBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  eventChipBadgeTextSelected: {
    color: '#FFFFFF',
  },
  viewEventSubpageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  viewEventSubpageText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.accent,
  },
  eventDropdownLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 8,
  },
  eventDropdownIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Palette.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventDropdownTextGroup: {
    flex: 1,
    gap: 1,
  },
  eventDropdownEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: Palette.accent,
  },
  eventDropdownTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  eventDropdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventDropdownBadge: {
    backgroundColor: Palette.background,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  eventDropdownBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  dropdownModalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: Palette.surface,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  dropdownListContent: {
    gap: 8,
    paddingVertical: 4,
  },
  dropdownOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.background,
  },
  dropdownOptionRowSelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.successSoft,
  },
  dropdownOptionLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 8,
  },
  dropdownOptionCopy: {
    flex: 1,
    gap: 2,
  },
  dropdownOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  dropdownOptionTitleSelected: {
    color: Palette.accent,
  },
  dropdownOptionSub: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  dropdownCountBadge: {
    backgroundColor: Palette.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  dropdownCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  searchAndFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: Palette.text,
  },
  searchClearBtn: {
    padding: 2,
  },
  manualFilterBtn: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  manualFilterBtnActive: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  manualFilterBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  manualFilterBtnTextActive: {
    color: '#FFFFFF',
  },
  filterActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Palette.success,
  },
  chipCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: Palette.borderLight,
    marginLeft: 6,
  },
  chipCountBadgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  chipCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  chipCountTextSelected: {
    color: Palette.successText,
  },
  filterModalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: Palette.surface,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalHeaderTitleGroup: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  filterModalContent: {
    gap: 8,
    paddingVertical: 6,
  },
  filterOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  filterModalOption: {
    minWidth: 80,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterModalOptionSelected: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  filterModalOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.text,
  },
  filterModalOptionTextSelected: {
    color: '#FFFFFF',
  },
  activeFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  activeFiltersText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  resetFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resetFiltersText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  viewAll: {
    padding: 4,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  filterRow: {
    marginBottom: 12,
    gap: 8,
  },
  filterChip: {
    minWidth: 96,
    maxWidth: 220,
    minHeight: 40,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    backgroundColor: Palette.surface,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: Palette.successSoft,
    borderColor: Palette.successText,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  filterChipTextSelected: {
    color: Palette.successText,
  },
  card: {
    borderRadius: 16,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  groupsContainer: {
    gap: 14,
  },
  eventCardGroup: {
    backgroundColor: Palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  eventGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Palette.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.border,
  },
  eventGroupTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  eventGroupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  eventCountBadge: {
    backgroundColor: Palette.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  eventCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  eventGroupList: {
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  emptyState: {
    padding: 16,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  emptyDetail: {
    marginTop: 2,
    fontSize: 12,
    color: Palette.textSecondary,
  },
  row: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Palette.borderLight,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowPressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    marginLeft: 8,
    flex: 1,
  },
  rowName: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  rowStatus: {
    marginTop: 1,
    fontSize: 11,
    color: Palette.textSecondary,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 1,
  },
  rowTime: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  rowSync: {
    fontSize: 10,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  rowAction: {
    minHeight: 26,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActionDanger: {
    borderColor: Palette.danger,
  },
  rowActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.text,
  },
  rowActionDangerText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.dangerText,
  },
  messagePanel: {
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  messageSuccess: {
    borderColor: Palette.successText,
    backgroundColor: Palette.successSoft,
  },
  messageError: {
    borderColor: Palette.danger,
    backgroundColor: Palette.dangerSoft,
  },
  messageText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 12, 8, 0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalKeyboardView: {
    width: '100%',
    maxHeight: '92%',
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '100%',
    alignSelf: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 24,
  },
  modalContent: {
    padding: 24,
    gap: 8,
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: Palette.successText,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  fieldLabel: {
    marginTop: 8,
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
  yearOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  yearOption: {
    flexBasis: 110,
    flexGrow: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: Palette.background,
  },
  yearOptionSelected: {
    backgroundColor: Palette.successSoft,
    borderColor: Palette.successText,
  },
  yearOptionText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  yearOptionTextSelected: {
    color: Palette.successText,
  },
  inlineError: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Palette.dangerSoft,
    borderRadius: 12,
    backgroundColor: Palette.dangerSoft,
    padding: 12,
  },
  inlineErrorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.dangerText,
  },
  modalActions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 48,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  primaryButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.48,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  deleteButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Palette.dangerText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCard: {
    maxWidth: 520,
    padding: 24,
    gap: 8,
  },
  deleteWarning: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.dangerText,
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

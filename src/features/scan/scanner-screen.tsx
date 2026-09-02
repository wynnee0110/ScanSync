import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import {
  deriveYearLevelFromStudentId,
  formatYearLevel,
  YEAR_LEVELS,
} from '@/features/attendance/year-level';
import { listActiveEvents, recordQrAttendance } from '@/features/events/event-repository';
import { isEventCreatedByUser, type AttendanceQrParticipant, type LocalEvent, type YearLevel } from '@/features/events/event-types';
import { parseAttendanceQrPayload } from '@/features/scan/qr-payload';
import { ScannerManualEntry } from '@/features/scan/scanner-manual-entry';
import {
  SCANNER_BOX_SIZE,
  ScannerOverlay,
  type ScannerOverlayProps,
} from '@/features/scan/scanner-overlay';
import { ScannerVerificationPill } from '@/features/scan/scanner-verification-pill';
import { getPreference, SELECTED_EVENT_KEY, setPreference } from '@/lib/preferences';

type ScanFeedback = {
  tone: 'idle' | 'success' | 'warning' | 'error';
  title: string;
  detail: string;
};

const IDLE_FEEDBACK: ScanFeedback = {
  tone: 'idle',
  title: 'Ready to scan',
  detail: 'Place one participant QR code inside the frame.',
};

export function ScannerScreen() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const successPlayer = useAudioPlayer(require('../../../assets/sounds/Success.mp3'));
  const failedPlayer = useAudioPlayer(require('../../../assets/sounds/Failed.mp3'));
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE_FEEDBACK);
  const [scannedParticipant, setScannedParticipant] = useState<AttendanceQrParticipant | null>(null);
  const [yearPromptVisible, setYearPromptVisible] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [torch, setTorch] = useState(false);
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const scanLock = useRef(false);
  const autoResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoResetTimer.current) {
        clearTimeout(autoResetTimer.current);
      }
    };
  }, []);

  const playSuccessSound = useCallback(() => {
    try {
      successPlayer.seekTo(0);
      successPlayer.play();
    } catch {
      // Audio playback fallback if silent/muted
    }
  }, [successPlayer]);

  const playFailedSound = useCallback(() => {
    try {
      failedPlayer.seekTo(0);
      failedPlayer.play();
    } catch {
      // Audio playback fallback if silent/muted
    }
  }, [failedPlayer]);

  const resetScanner = useCallback(() => {
    if (autoResetTimer.current) {
      clearTimeout(autoResetTimer.current);
      autoResetTimer.current = null;
    }
    scanLock.current = false;
    setScannerLocked(false);
    setFeedback(IDLE_FEEDBACK);
    setScannedParticipant(null);
    setYearPromptVisible(false);
    setSavingAttendance(false);
  }, []);

  const scheduleAutoReset = useCallback(
    (delayMs = 2000) => {
      if (autoResetTimer.current) {
        clearTimeout(autoResetTimer.current);
      }
      autoResetTimer.current = setTimeout(() => {
        resetScanner();
      }, delayMs);
    },
    [resetScanner],
  );

  const { user, localUser, role: userRole, assignedEventId } = useAuth();

  const loadEvents = useCallback(async () => {
    try {
      const [allActiveEvents, storedEventId] = await Promise.all([
        listActiveEvents(),
        getPreference(SELECTED_EVENT_KEY).catch(() => null),
      ]);
      const activeEvents = allActiveEvents.filter((e) => {
        if (userRole === 'Superadmin') return true;
        if (userRole === 'Organizer') {
          return (
            isEventCreatedByUser(e.createdBy, user, localUser) ||
            e.id === assignedEventId
          );
        }
        if (userRole === 'Volunteer') {
          return e.id === assignedEventId;
        }
        return true;
      });
      setEvents(activeEvents);
      setSelectedEventId((current) => {
        const preferred = storedEventId ?? current;
        return preferred && activeEvents.some((event) => event.id === preferred)
          ? preferred
          : (activeEvents[0]?.id ?? null);
      });
    } catch {
      setFeedback({
        tone: 'error',
        title: 'Events unavailable',
        detail: 'The active event list could not be loaded.',
      });
    }
  }, [userRole, user, localUser, assignedEventId]);

  useFocusEffect(
    useCallback(() => {
      setCameraActive(true);
      void loadEvents();
      return () => setCameraActive(false);
    }, [loadEvents]),
  );

  const isInsideViewfinder = useCallback(
    (result: BarcodeScanningResult): boolean => {
      if (!layout || layout.width <= 0 || layout.height <= 0) {
        return true;
      }
      const boxSize = SCANNER_BOX_SIZE;
      const boxMinX = (layout.width - boxSize) / 2;
      const boxMaxX = (layout.width + boxSize) / 2;
      const boxMinY = (layout.height - boxSize) / 2;
      const boxMaxY = (layout.height + boxSize) / 2;
      const tolerance = 40;

      let qrX: number | null = null;
      let qrY: number | null = null;

      if (result.cornerPoints && result.cornerPoints.length > 0) {
        const sumX = result.cornerPoints.reduce((acc, point) => acc + point.x, 0);
        const sumY = result.cornerPoints.reduce((acc, point) => acc + point.y, 0);
        qrX = sumX / result.cornerPoints.length;
        qrY = sumY / result.cornerPoints.length;
      } else if (result.bounds) {
        const { origin, size } = result.bounds;
        qrX = origin.x + size.width / 2;
        qrY = origin.y + size.height / 2;
      }

      if (qrX === null || qrY === null) {
        return true;
      }

      if (qrX <= 1 && qrY <= 1) {
        qrX *= layout.width;
        qrY *= layout.height;
      }

      return (
        qrX >= boxMinX - tolerance &&
        qrX <= boxMaxX + tolerance &&
        qrY >= boxMinY - tolerance &&
        qrY <= boxMaxY + tolerance
      );
    },
    [layout],
  );

  const saveAttendance = useCallback(
    async (
      participant: AttendanceQrParticipant,
      eventId: string,
      yearLevel: YearLevel,
      yearLevelLabel = formatYearLevel(yearLevel),
    ) => {
      if (savingAttendance) {
        return;
      }

      setSavingAttendance(true);
      try {
        const result = await recordQrAttendance(eventId, participant, yearLevel);
        setYearPromptVisible(false);
        if (result.status === 'duplicate') {
          playFailedSound();
          setFeedback({
            tone: 'warning',
            title: 'Already checked in',
            detail:
              'This participant already has attendance for the selected event. Its saved year level was not changed.',
          });
          scheduleAutoReset(2000);
          return;
        }

        playSuccessSound();

        setFeedback({
          tone: 'success',
          title: 'Attendance recorded',
          detail: `${participant.claimedName ?? 'Participant'} — ${yearLevelLabel}. Stored locally and queued for synchronization.`,
        });
        await loadEvents();
        scheduleAutoReset(2000);
      } catch {
        playFailedSound();
        setYearPromptVisible(false);
        setFeedback({
          tone: 'error',
          title: 'Could not save attendance',
          detail: 'No record was created.',
        });
        scheduleAutoReset(2000);
      } finally {
        setSavingAttendance(false);
      }
    },
    [
      loadEvents,
      playFailedSound,
      playSuccessSound,
      savingAttendance,
      scheduleAutoReset,
    ],
  );

  const handleYearLevelSelected = useCallback(
    async (yearLevel: YearLevel) => {
      if (!scannedParticipant || !selectedEventId) {
        return;
      }

      await saveAttendance(scannedParticipant, selectedEventId, yearLevel);
    },
    [saveAttendance, scannedParticipant, selectedEventId],
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (scanLock.current || !selectedEventId) {
        return;
      }
      const participant = parseAttendanceQrPayload(data);

      if (!participant) {
        scanLock.current = true;
        setScannerLocked(true);
        playFailedSound();
        setScannedParticipant(null);
        setFeedback({
          tone: 'error',
          title: 'Unsupported QR code',
          detail: 'Expected a university ID QR containing name, 10-digit ID, and program.',
        });
        scheduleAutoReset(2000);
        return;
      }

      // Lock immediately so repeated camera frames cannot create duplicate async saves.
      scanLock.current = true;
      setScannerLocked(true);
      setScannedParticipant(participant);

      const event = events.find((candidate) => candidate.id === selectedEventId);
      const derivation =
        participant.qrFormat === 'school_id' && event
          ? deriveYearLevelFromStudentId(
              participant.participantReference,
              event.academicReferenceYear,
            )
          : null;

      if (derivation?.status === 'derived') {
        const yearLevelLabel = derivation.capped
          ? '4th year and above'
          : formatYearLevel(derivation.yearLevel);
        setFeedback({
          tone: 'idle',
          title: 'QR code read',
          detail: `${participant.claimedName ?? 'Participant'} — ${yearLevelLabel}. Saving attendance...`,
        });
        void saveAttendance(
          participant,
          selectedEventId,
          derivation.yearLevel,
          yearLevelLabel,
        );
        return;
      }

      setFeedback({
        tone: 'warning',
        title: 'Year level needs confirmation',
        detail:
          derivation?.status === 'unavailable' && derivation.reason === 'future_entry_year'
            ? 'The ID entry year is later than this event academic year.'
            : 'This QR reference does not contain a usable entry year.',
      });
      setYearPromptVisible(true);
    },
    [events, playFailedSound, saveAttendance, scheduleAutoReset, selectedEventId],
  );

  const handleManualVerified = useCallback(
    async (studentName: string, idNumber: string, course: string) => {
      if (!selectedEventId) {
        setFeedback({
          tone: 'error',
          title: 'No event selected',
          detail: 'Please select an event before completing manual check-in.',
        });
        return;
      }

      const participant: AttendanceQrParticipant = {
        participantReference: idNumber.trim(),
        claimedName: studentName.trim(),
        claimedProgram: course.trim(),
        qrFormat: 'school_id',
      };

      const event = events.find((e) => e.id === selectedEventId);
      const derivation = event
        ? deriveYearLevelFromStudentId(idNumber.trim(), event.academicReferenceYear)
        : null;

      const yearLevel = derivation?.status === 'derived' ? derivation.yearLevel : null;
      const yearLabel =
        derivation?.status === 'derived'
          ? derivation.capped
            ? '4th year and above'
            : formatYearLevel(derivation.yearLevel)
          : 'Unspecified year';

      try {
        const result = await recordQrAttendance(selectedEventId, participant, yearLevel, 'manual');
        if (result.status === 'duplicate') {
          playFailedSound();
          setFeedback({
            tone: 'warning',
            title: 'Already checked in',
            detail: `${studentName} (ID: ${idNumber}) already has attendance recorded for this event.`,
          });
        } else {
          playSuccessSound();
          setFeedback({
            tone: 'success',
            title: 'Manual check-in recorded',
            detail: `${studentName} (ID: ${idNumber}, ${course}) — ${yearLabel}. Saved locally.`,
          });
          await loadEvents();
        }
      } catch {
        playFailedSound();
        setFeedback({
          tone: 'error',
          title: 'Could not save manual check-in',
          detail: 'Failed to record attendance locally.',
        });
      }
      scheduleAutoReset(2500);
    },
    [events, loadEvents, playFailedSound, playSuccessSound, scheduleAutoReset, selectedEventId],
  );

  const handleCameraScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (isInsideViewfinder(result)) {
        handleBarcodeScanned(result);
      }
    },
    [handleBarcodeScanned, isInsideViewfinder],
  );

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;
  const canShowCamera = permission?.granted && Boolean(selectedEventId);
  const isInsecureWebCamera =
    Platform.OS === 'web' && typeof window !== 'undefined' && !window.isSecureContext;

  const overlayHeader = selectedEvent ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change event, currently ${selectedEvent.name}`}
      onPress={() => setSelectorOpen(true)}
      style={({ pressed }) => [styles.headerEventSelectorBtn, pressed && styles.pressed]}>
      <Text style={styles.eventTitleText} numberOfLines={1}>
        {selectedEvent.name}
      </Text>
      <Ionicons name="chevron-down" size={14} color="#FFFFFF" style={{ marginLeft: 4 }} />
    </Pressable>
  ) : undefined;

  const overlayProps: ScannerOverlayProps = {
    torch,
    onToggleTorch: () => setTorch((value) => !value),
    header: events.length > 0 ? overlayHeader : undefined,
  };

  return (
    <View
      style={styles.screen}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
      }}>
      {!permission ? (
        <View style={styles.screen} />
      ) : isInsecureWebCamera ? (
        <View style={styles.panelWrap}>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Camera blocked on this LAN page</Text>
            <Text style={styles.panelDetail}>
              Safari requires HTTPS for camera access. Scan the native Expo QR code from the
              terminal and open this project in Expo Go instead of opening the web address.
            </Text>
          </View>
        </View>
      ) : !permission.granted ? (
        <View style={styles.panelWrap}>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Camera access required</Text>
            <Text style={styles.panelDetail}>
              {permission.canAskAgain
                ? 'Camera access is used only to read participant QR codes.'
                : Platform.OS === 'web'
                  ? 'Enable camera access in the browser site settings, then check again.'
                  : 'Camera access was denied. Enable it for this app in device settings.'}
            </Text>
            {permission.canAskAgain ? (
              <Pressable
                accessibilityRole="button"
                onPress={requestPermission}
                style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}>
                <Text style={styles.panelButtonText}>Allow Camera</Text>
              </Pressable>
            ) : Platform.OS === 'web' ? (
              <Pressable
                accessibilityRole="button"
                onPress={getPermission}
                style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}>
                <Text style={styles.panelButtonText}>Check again</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openSettings()}
                style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}>
                <Text style={styles.panelButtonText}>Open settings</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : !selectedEventId ? (
        <View style={styles.panelWrap}>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Create an active event first</Text>
            <Text style={styles.panelDetail}>Draft events do not appear in the scanner.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/')}
              style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}>
              <Text style={styles.panelButtonText}>Open events</Text>
            </Pressable>
          </View>
        </View>
      ) : canShowCamera ? (
        <>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            active={cameraActive && !yearPromptVisible}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scannerLocked ? undefined : handleCameraScan}
            onMountError={() =>
              setFeedback({
                tone: 'error',
                title: 'Camera unavailable',
                detail: 'Close other camera apps, then reopen this screen.',
              })
            }
          />

          <ScannerOverlay {...overlayProps} />

          <ScannerVerificationPill
            tone={feedback.tone}
            title={feedback.title}
            detail={feedback.detail}
          />

          <ScannerManualEntry onVerified={handleManualVerified} />
        </>
      ) : null}

      <Modal
        animationType="fade"
        transparent
        visible={yearPromptVisible}
        onRequestClose={() => {
          if (!savingAttendance) resetScanner();
        }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>COMPLETE CHECK-IN</Text>
            <Text style={styles.modalTitle}>Confirm year level</Text>
            <Text style={styles.modalSubtitle}>
              A year level could not be derived for{' '}
              {scannedParticipant?.claimedName ?? 'this participant'}. Confirm it to finish the
              check-in.
            </Text>

            <View style={styles.yearOptions}>
              {YEAR_LEVELS.map((yearLevel) => (
                <Pressable
                  key={yearLevel}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${formatYearLevel(yearLevel)}`}
                  disabled={savingAttendance}
                  onPress={() => void handleYearLevelSelected(yearLevel)}
                  style={({ pressed }) => [
                    styles.yearOption,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.yearOptionNumber}>{yearLevel}</Text>
                  <Text style={styles.yearOptionLabel}>{formatYearLevel(yearLevel)}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={savingAttendance}
              onPress={resetScanner}
              style={({ pressed }) => [
                styles.modalCancel,
                savingAttendance && styles.modalCancelDisabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.modalCancelText}>
                {savingAttendance ? 'Saving...' : 'Cancel scan'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* EVENT SELECTOR MODAL */}
      <Modal
        animationType="slide"
        transparent
        visible={selectorOpen}
        onRequestClose={() => setSelectorOpen(false)}>
        <Pressable
          style={styles.selectorBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close event selector"
          onPress={() => setSelectorOpen(false)}>
          <View style={styles.selectorSheet}>
            <View style={styles.selectorHandle} />
            <Text style={styles.selectorSheetTitle}>Select Event</Text>
            <Text style={styles.selectorSheetSubtitle}>Choose active event destination</Text>
            <ScrollView style={styles.selectorList} showsVerticalScrollIndicator={false}>
              {events.map((e) => {
                const isSelected = e.id === selectedEventId;
                return (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedEventId(e.id);
                      void setPreference(SELECTED_EVENT_KEY, e.id);
                      setSelectorOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.selectorItemRow,
                      isSelected && styles.selectorItemRowSelected,
                      pressed && styles.pressed,
                    ]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.selectorItemTitle, isSelected && styles.selectorItemTitleSelected]}>
                        {e.name}
                      </Text>
                      {Boolean(e.venue) && (
                        <Text style={styles.selectorItemSub}>{e.venue}</Text>
                      )}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={18} color="#0284C7" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  eventTitleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  panelWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1120',
    paddingHorizontal: 24,
  },
  panel: {
    alignItems: 'center',
    maxWidth: 420,
    gap: 12,
  },
  panelTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  panelDetail: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  panelButton: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  panelButtonText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 12, 8, 0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 24,
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
    fontSize: 14,
    color: Palette.textSecondary,
  },
  yearOptions: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  yearOption: {
    flexBasis: '46%',
    flexGrow: 1,
    minHeight: 96,
    borderWidth: 1,
    borderColor: Palette.successText,
    borderRadius: 14,
    backgroundColor: Palette.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  yearOptionNumber: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: Palette.successText,
  },
  yearOptionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.successText,
  },
  modalCancel: {
    marginTop: 8,
    minHeight: 48,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelDisabled: {
    opacity: 0.48,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  headerEventSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 240,
  },
  selectorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
    justifyContent: 'flex-end',
  },
  selectorSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  selectorHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Palette.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  selectorSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
    marginBottom: 2,
  },
  selectorSheetSubtitle: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginBottom: 16,
  },
  selectorList: {
    marginBottom: 8,
  },
  selectorItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: Palette.background,
  },
  selectorItemRowSelected: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#0284C7',
  },
  selectorItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.text,
  },
  selectorItemTitleSelected: {
    color: '#0284C7',
    fontWeight: '700',
  },
  selectorItemSub: {
    fontSize: 12,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
});

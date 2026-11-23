import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import type { LocalEvent } from '@/features/events/event-types';
import type { OperatorRole } from '@/features/operators/operator-types';

type AddOperatorModalProps = {
  isOpen: boolean;
  events: LocalEvent[];
  formName: string;
  formEmail: string;
  formPassword?: string;
  formRole: OperatorRole;
  formEventId: string | null;
  isOrganizerContext?: boolean;
  lockedEventName?: string;
  onChangeName: (text: string) => void;
  onChangeEmail: (text: string) => void;
  onChangePassword?: (text: string) => void;
  onChangeRole: (role: OperatorRole) => void;
  onChangeEventId: (eventId: string | null) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function AddOperatorModal({
  isOpen,
  events,
  formName,
  formEmail,
  formPassword = '',
  formRole,
  formEventId,
  isOrganizerContext = false,
  lockedEventName,
  onChangeName,
  onChangeEmail,
  onChangePassword,
  onChangeRole,
  onChangeEventId,
  onClose,
  onSubmit,
}: AddOperatorModalProps) {
  const modalTitle = isOrganizerContext ? 'Add Volunteer' : 'Add Operator Access';
  const modalSubtitle = isOrganizerContext
    ? 'Assign a volunteer account & password for your event'
    : 'Assign operator account & login password';

  return (
    <Modal
      animationType="slide"
      transparent
      visible={isOpen}
      onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{modalTitle}</Text>
          <Text style={styles.modalSubtitle}>{modalSubtitle}</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.modalFormScroll}
            contentContainerStyle={styles.modalFormScrollContent}>
            {/* Field: Full Name */}
            <Text style={styles.inputLabel}>Operator Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Juan Dela Cruz"
              placeholderTextColor={Palette.textSecondary}
              value={formName}
              onChangeText={onChangeName}
            />

            {/* Field: Access Email */}
            <Text style={styles.inputLabel}>Access Email *</Text>
            <TextInput
              style={styles.textInput}
              placeholder={
                isOrganizerContext
                  ? 'e.g. juan.volunteer@gmail.com'
                  : 'e.g. juan.organizer@gmail.com'
              }
              placeholderTextColor={Palette.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              value={formEmail}
              onChangeText={onChangeEmail}
            />

            {/* Field: Password / Access Code */}
            <Text style={styles.inputLabel}>Access Password / Code (min 6 chars)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Password123 or leave blank to auto-generate"
              placeholderTextColor={Palette.textSecondary}
              autoCapitalize="none"
              value={formPassword}
              onChangeText={onChangePassword}
            />


            {/* Field: Role */}
            <Text style={styles.inputLabel}>Role Permission</Text>

            {isOrganizerContext && (
              <Text style={styles.contextNoticeText}>
                As an Organizer, you may only assign Volunteers for your event.
              </Text>
            )}
            <View style={styles.rolePickerRow}>
              {(isOrganizerContext
                ? (['Volunteer'] as OperatorRole[])
                : (['Volunteer', 'Organizer', 'Superadmin'] as OperatorRole[])
              ).map((r) => {
                const isSelected = formRole === r;
                const isDisabled = isOrganizerContext && r !== 'Volunteer';
                return (
                  <Pressable
                    key={r}
                    accessibilityRole="radio"
                    accessibilityLabel={`Role: ${r}`}
                    accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                    disabled={isDisabled}
                    onPress={() => !isDisabled && onChangeRole(r)}
                    style={[
                      styles.roleChip,
                      isSelected && styles.roleChipSelected,
                      isDisabled && styles.roleChipDisabled,
                    ]}>
                    <Text
                      style={[
                        styles.roleChipText,
                        isSelected && styles.roleChipTextSelected,
                        isDisabled && styles.roleChipTextDisabled,
                      ]}>
                      {r}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Field: Event Selection */}
            {formRole === 'Volunteer' && (
              <>
                <Text style={styles.inputLabel}>Assigned Event Access *</Text>
                <View style={styles.eventListContainer}>
                  {events.length === 0 ? (
                    <View style={styles.noEventsBox}>
                      <Ionicons
                        name="calendar-outline"
                        size={20}
                        color={Palette.textSecondary}
                      />
                      <Text style={styles.noEventsText}>
                        No events found. Create an event first.
                      </Text>
                    </View>
                  ) : (
                    events.map((e) => (
                      <Pressable
                        key={e.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: formEventId === e.id }}
                        onPress={() => onChangeEventId(e.id)}
                        style={[
                          styles.eventOptionCard,
                          formEventId === e.id && styles.eventOptionSelected,
                        ]}>
                        <Ionicons
                          name={
                            formEventId === e.id ? 'radio-button-on' : 'radio-button-off'
                          }
                          size={18}
                          color={
                            formEventId === e.id ? Palette.accent : Palette.textSecondary
                          }
                        />
                        <View style={styles.eventOptionInfo}>
                          <Text style={styles.eventOptionTitle}>{e.name}</Text>
                          <Text
                            style={[
                              styles.eventOptionStatus,
                              e.status === 'completed' && { color: Palette.danger },
                            ]}>
                            Status:{' '}
                            {e.status === 'completed'
                              ? 'Completed (Access auto-revoked)'
                              : e.status.toUpperCase()}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              </>
            )}

            {formRole === 'Organizer' && (
              <View style={styles.autoCodeNoticeBox}>
                <Ionicons name="information-circle-outline" size={16} color={Palette.accent} />
                <Text style={styles.autoCodeNoticeText}>
                  Organizers can create and manage their own events without being locked to a single event.
                </Text>
              </View>
            )}

            {/* Auto-Generation Notice */}
            <View style={styles.autoCodeNoticeBox}>
              <Ionicons name="key-outline" size={16} color={Palette.accent} />
              <Text style={styles.autoCodeNoticeText}>
                A unique password access code will be automatically generated upon creation.
              </Text>
            </View>

            {/* Form Buttons */}
            <View style={styles.modalActionRow}>
              <Pressable
                onPress={onClose}
                style={[styles.modalBtn, styles.cancelModalBtn]}>
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                style={[styles.modalBtn, styles.saveModalBtn]}>
                <Text style={styles.saveModalBtnText}>
                  {isOrganizerContext ? 'Add Volunteer' : 'Grant Access'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: 20,
    maxHeight: '85%',
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
    fontSize: 20,
    fontWeight: '800',
    color: Palette.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginBottom: 16,
  },
  modalFormScroll: {
    flexGrow: 0,
  },
  modalFormScrollContent: {
    paddingBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
    marginTop: 12,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Palette.text,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    backgroundColor: Palette.background,
  },
  contextNoticeText: {
    fontSize: 12,
    color: Palette.accent,
    marginBottom: 6,
    fontStyle: 'italic',
  },
  roleChipSelected: {
    borderColor: Palette.accent,
    backgroundColor: '#F3F4F6',
  },
  roleChipDisabled: {
    opacity: 0.4,
    backgroundColor: '#E5E7EB',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  roleChipTextSelected: {
    color: Palette.accent,
    fontWeight: '700',
  },
  roleChipTextDisabled: {
    color: Palette.textSecondary,
  },
  eventListContainer: {
    gap: 8,
  },
  noEventsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    borderStyle: 'dashed',
    backgroundColor: Palette.background,
  },
  noEventsText: {
    fontSize: 13,
    color: Palette.textSecondary,
    flex: 1,
  },
  eventOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderLight,
    backgroundColor: Palette.background,
  },
  eventOptionSelected: {
    borderColor: Palette.accent,
    backgroundColor: '#F3F4F6',
  },
  eventOptionInfo: {
    flex: 1,
  },
  eventOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  eventOptionStatus: {
    fontSize: 11,
    color: Palette.textSecondary,
  },
  autoCodeNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  autoCodeNoticeText: {
    fontSize: 12,
    color: Palette.textSecondary,
    flex: 1,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 4,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelModalBtn: {
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderLight,
  },
  cancelModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  saveModalBtn: {
    backgroundColor: Palette.accent,
  },
  saveModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.7,
  },
});

import type { AttendanceQrParticipant } from '@/features/events/event-types';

export const SAMPLE_QR_PAYLOAD = 'NAME [tab] STUDENT ID [tab] PROGRAM';

const QR_PAYLOAD_PATTERN = /^attendance:\/\/participant\/([A-Za-z0-9_-]{6,128})$/;
const STUDENT_ID_PATTERN = /^\d{10}$/;
const PROGRAM_PATTERN = /^[A-Za-z0-9 .&()+\/-]{2,32}$/;
const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/;

function normalizeField(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function parseAttendanceQrPayload(value: string): AttendanceQrParticipant | null {
  const normalizedValue = value.normalize('NFKC').trim();
  const opaqueMatch = QR_PAYLOAD_PATTERN.exec(normalizedValue);

  if (opaqueMatch) {
    return {
      participantReference: opaqueMatch[1],
      claimedName: null,
      claimedProgram: null,
      qrFormat: 'opaque',
    };
  }

  if (FORBIDDEN_CONTROL_PATTERN.test(normalizedValue)) {
    return null;
  }

  const fields = normalizedValue.split('\t');
  if (fields.length !== 3) {
    return null;
  }

  const [name, studentId, program] = fields.map(normalizeField);
  if (
    name.length < 2 ||
    name.length > 120 ||
    !STUDENT_ID_PATTERN.test(studentId) ||
    !PROGRAM_PATTERN.test(program)
  ) {
    return null;
  }

  return {
    participantReference: studentId,
    claimedName: name,
    claimedProgram: program,
    qrFormat: 'school_id',
  };
}

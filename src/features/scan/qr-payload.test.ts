import { describe, expect, it } from 'vitest';

import { parseAttendanceQrPayload } from './qr-payload';

describe('parseAttendanceQrPayload', () => {
  it('extracts a tab-separated university identity as a validated claim', () => {
    expect(parseAttendanceQrPayload('SAMPLE STUDENT\t2024000000\tBSCpE')).toEqual({
      participantReference: '2024000000',
      claimedName: 'SAMPLE STUDENT',
      claimedProgram: 'BSCpE',
      qrFormat: 'school_id',
    });
  });

  it('normalizes harmless spacing in university fields', () => {
    expect(parseAttendanceQrPayload('  SAMPLE   STUDENT \t 2024000000 \t BSCpE  ')).toMatchObject({
      participantReference: '2024000000',
      claimedName: 'SAMPLE STUDENT',
      claimedProgram: 'BSCpE',
    });
  });

  it('keeps managed opaque participant codes compatible', () => {
    expect(parseAttendanceQrPayload('attendance://participant/TEST-0001')).toEqual({
      participantReference: 'TEST-0001',
      claimedName: null,
      claimedProgram: null,
      qrFormat: 'opaque',
    });
  });

  it.each([
    'SAMPLE STUDENT\tinvalid\tBSCpE',
    'SAMPLE STUDENT\n2024000000\nBSCpE',
    'SAMPLE STUDENT\t2024000000',
    'SAMPLE STUDENT\t2024000000\tBSCpE\textra',
  ])('rejects malformed input: %s', (payload) => {
    expect(parseAttendanceQrPayload(payload)).toBeNull();
  });
});

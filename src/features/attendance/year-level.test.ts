import { describe, expect, it } from 'vitest';

import {
  countYearLevels,
  deriveYearLevelFromStudentId,
  formatYearLevel,
  isYearLevel,
} from './year-level';

describe('year-level helpers', () => {
  it('counts all four levels and preserves legacy unknown records', () => {
    expect(countYearLevels([1, 1, 2, 3, 4, null])).toEqual({
      counts: { 1: 2, 2: 1, 3: 1, 4: 1 },
      unknown: 1,
    });
  });

  it('validates and formats supported year levels', () => {
    expect(isYearLevel(4)).toBe(true);
    expect(isYearLevel(5)).toBe(false);
    expect(formatYearLevel(1)).toBe('1st year');
    expect(formatYearLevel(4)).toBe('4th year');
  });

  it.each([
    ['2026000000', 1, false],
    ['2025000000', 2, false],
    ['2024000000', 3, false],
    ['2023000000', 4, false],
    ['2022000000', 4, true],
    ['2021000000', 4, true],
  ])(
    'derives %s against academic reference year 2026 as year level %i',
    (studentId, expectedYearLevel, expectedCapped) => {
      expect(deriveYearLevelFromStudentId(studentId, 2026)).toEqual({
        status: 'derived',
        yearLevel: expectedYearLevel,
        entryYear: Number(studentId.slice(0, 4)),
        capped: expectedCapped,
      });
    },
  );

  it('advances the same entry cohort when the event academic year advances', () => {
    expect(deriveYearLevelFromStudentId('2026000000', 2026)).toMatchObject({
      status: 'derived',
      yearLevel: 1,
    });
    expect(deriveYearLevelFromStudentId('2026000000', 2027)).toMatchObject({
      status: 'derived',
      yearLevel: 2,
    });
    expect(deriveYearLevelFromStudentId('2027000000', 2027)).toMatchObject({
      status: 'derived',
      yearLevel: 1,
    });
  });

  it.each([null, undefined, '', 'TEST-0001', '202600000', 'x2026000000']) (
    'does not invent a year level for invalid or opaque reference %s',
    (studentId) => {
      expect(deriveYearLevelFromStudentId(studentId, 2026)).toEqual({
        status: 'unavailable',
        reason: 'invalid_id',
      });
    },
  );

  it('rejects future entry years and invalid academic reference years', () => {
    expect(deriveYearLevelFromStudentId('2027000000', 2026)).toEqual({
      status: 'unavailable',
      reason: 'future_entry_year',
    });
    expect(deriveYearLevelFromStudentId('2026000000', Number.NaN)).toEqual({
      status: 'unavailable',
      reason: 'invalid_reference_year',
    });
  });
});

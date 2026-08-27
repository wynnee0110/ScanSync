import type { YearLevel, YearLevelCounts } from '@/features/events/event-types';

export const YEAR_LEVELS: readonly YearLevel[] = [1, 2, 3, 4];

export type YearLevelDerivation =
  | {
      status: 'derived';
      yearLevel: YearLevel;
      entryYear: number;
      capped: boolean;
    }
  | {
      status: 'unavailable';
      reason: 'invalid_id' | 'invalid_reference_year' | 'future_entry_year';
    };

const STUDENT_ID_WITH_ENTRY_YEAR_PATTERN = /^(\d{4})\d{6}$/;

export function deriveYearLevelFromStudentId(
  studentId: string | null | undefined,
  academicReferenceYear: number,
): YearLevelDerivation {
  if (
    !Number.isInteger(academicReferenceYear) ||
    academicReferenceYear < 1900 ||
    academicReferenceYear > 9999
  ) {
    return { status: 'unavailable', reason: 'invalid_reference_year' };
  }

  const match = studentId
    ? STUDENT_ID_WITH_ENTRY_YEAR_PATTERN.exec(studentId.trim())
    : null;
  if (!match) {
    return { status: 'unavailable', reason: 'invalid_id' };
  }

  const entryYear = Number(match[1]);
  if (entryYear < 1900) {
    return { status: 'unavailable', reason: 'invalid_id' };
  }

  const calculatedLevel = academicReferenceYear - entryYear + 1;
  if (calculatedLevel < 1) {
    return { status: 'unavailable', reason: 'future_entry_year' };
  }

  return {
    status: 'derived',
    yearLevel: Math.min(4, calculatedLevel) as YearLevel,
    entryYear,
    capped: calculatedLevel > 4,
  };
}

export function createEmptyYearLevelCounts(): YearLevelCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

export function isYearLevel(value: unknown): value is YearLevel {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function formatYearLevel(yearLevel: YearLevel): string {
  if (yearLevel === 1) return '1st year';
  if (yearLevel === 2) return '2nd year';
  if (yearLevel === 3) return '3rd year';
  return '4th year';
}

export function countYearLevels(values: readonly unknown[]): {
  counts: YearLevelCounts;
  unknown: number;
} {
  const counts = createEmptyYearLevelCounts();
  let unknown = 0;

  values.forEach((value) => {
    if (isYearLevel(value)) {
      counts[value] += 1;
    } else {
      unknown += 1;
    }
  });

  return { counts, unknown };
}

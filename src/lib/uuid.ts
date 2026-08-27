import { getRandomBytes } from 'expo-crypto';

import { formatUuidV4 } from '@/lib/uuid-format';

export function createUuid(): string {
  return formatUuidV4(getRandomBytes(16));
}

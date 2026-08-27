import { formatUuidV4 } from '@/lib/uuid-format';

export function createUuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return formatUuidV4(bytes);
}

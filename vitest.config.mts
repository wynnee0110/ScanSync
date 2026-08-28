import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/lib/uuid': fileURLToPath(new URL('./src/lib/uuid.web.ts', import.meta.url)),
      '@/lib/local-database': fileURLToPath(
        new URL('./src/lib/local-database.web.ts', import.meta.url),
      ),
      '@/lib/preferences': fileURLToPath(
        new URL('./src/lib/preferences.web.ts', import.meta.url),
      ),
      '@/features/events/event-repository': fileURLToPath(
        new URL('./src/features/events/event-repository.web.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __DEV__: 'true',
  },
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: ['expo-secure-store'],
      },
    },
    mockReset: false,
    setupFiles: [],
  },
});


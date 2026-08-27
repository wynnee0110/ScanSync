import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/lib/uuid': fileURLToPath(new URL('./src/lib/uuid.web.ts', import.meta.url)),
      '@/lib/local-database': fileURLToPath(
        new URL('./src/lib/local-database.web.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});

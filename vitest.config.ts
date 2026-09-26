import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,adapters}/*/src/**/*.test.ts'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __SHELLHERD_LABS__: 'true' },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', '.claude/skills/run-app/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
  },
});

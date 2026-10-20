import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', '.claude/skills/run-app/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
  },
});

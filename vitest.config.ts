import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Coverage is configured at the root and aggregated across all projects.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['server/src/**', 'web/src/**', 'shared/src/**'],
      // index.ts is just `createApp().listen()`; the app itself is covered via app.ts.
      exclude: ['**/dist/**', '**/*.d.ts', 'server/src/index.ts'],
    },
    projects: [
      {
        test: {
          name: 'server',
          root: './server',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './web',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
    ],
  },
});

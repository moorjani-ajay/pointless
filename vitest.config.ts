import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server suites share one throwaway Postgres (started in the server
    // project's globalSetup), so run test files serially to avoid cross-file
    // interference on the shared database.
    fileParallelism: false,
    // Coverage is configured at the root and aggregated across all projects.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['server/src/**', 'web/src/**', 'shared/src/**'],
      // index.ts is just init() + createApp().listen(); the app is covered via app.ts.
      exclude: ['**/dist/**', '**/*.d.ts', 'server/src/index.ts'],
    },
    projects: [
      {
        test: {
          name: 'server',
          root: './server',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          globalSetup: ['./test/globalSetup.ts'],
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

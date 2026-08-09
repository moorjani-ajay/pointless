import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

// Spin up one throwaway Postgres for the whole server test run and hand its URL
// to the suites via `inject('databaseUrl')`. Suites share it (vitest runs files
// serially — see `fileParallelism` in vitest.config.ts) and clear the table
// between cases. Override the image with TEST_POSTGRES_IMAGE.
export default async function setup({ provide }: GlobalSetupContext) {
  const image = process.env.TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine';
  const container = await new PostgreSqlContainer(image).start();
  provide('databaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}

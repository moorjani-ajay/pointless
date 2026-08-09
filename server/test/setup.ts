import { afterAll, beforeAll, inject } from 'vitest';
import * as store from '../src/db';

// Connect this suite to the throwaway Postgres started in globalSetup. The pool
// opens lazily, so setting DATABASE_URL before any store call is enough; init()
// creates the schema and endPool() releases the connection so the run exits.
beforeAll(async () => {
  process.env.DATABASE_URL = inject('databaseUrl');
  await store.init();
});

afterAll(async () => {
  await store.endPool();
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// db.ts opens its SQLite file at import time from DATA_DIR. Point each test
// file at its own throwaway directory so suites never share state.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pointless-test-'));

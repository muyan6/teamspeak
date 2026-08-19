import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as {
  DatabaseSync: unknown;
  StatementSync: unknown;
  constants: unknown;
  backup: unknown;
};

export const DatabaseSync = sqlite.DatabaseSync;
export const StatementSync = sqlite.StatementSync;
export const constants = sqlite.constants;
export const backup = sqlite.backup;
export default sqlite;

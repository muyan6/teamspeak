import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
it('sqlite', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(id INTEGER)');
  expect(db).toBeDefined();
});

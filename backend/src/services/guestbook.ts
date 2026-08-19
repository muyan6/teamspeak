import type { AppDatabase } from '../db/database.js';

export interface GuestbookEntry {
  id: number;
  nickname: string;
  content: string;
  createdAt: number;
}

export class GuestbookService {
  constructor(private db: AppDatabase) {}

  list(limit = 100): GuestbookEntry[] {
    return this.db
      .prepare(
        'SELECT id, nickname, content, created_at as createdAt FROM guestbook_entries ORDER BY created_at DESC LIMIT ?'
      )
      .all(limit) as GuestbookEntry[];
  }

  add(nickname: string, content: string): GuestbookEntry {
    const createdAt = Date.now();
    const info = this.db
      .prepare('INSERT INTO guestbook_entries (nickname, content, created_at) VALUES (?, ?, ?)')
      .run(nickname.trim().slice(0, 32), content.trim().slice(0, 2000), createdAt);
    return {
      id: Number(info.lastInsertRowid),
      nickname: nickname.trim().slice(0, 32),
      content: content.trim().slice(0, 2000),
      createdAt,
    };
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM guestbook_entries WHERE id = ?').run(id).changes > 0;
  }
}

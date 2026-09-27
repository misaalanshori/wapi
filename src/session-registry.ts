import type Database from "better-sqlite3";

export interface SessionRecord {
  id: string;
  chatJid: string;
  status: "active" | "paused";
  createdAt: string;
  lastActiveAt: string;
}

export class SessionRegistry {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id             TEXT PRIMARY KEY,
        chat_jid       TEXT NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('active', 'paused')),
        created_at     TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_chat_jid ON sessions(chat_jid);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `);
  }

  createSession(id: string, chatJid: string): SessionRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, chat_jid, status, created_at, last_active_at)
      VALUES (?, ?, 'active', ?, ?)
    `);
    stmt.run(id, chatJid, now, now);

    return {
      id,
      chatJid,
      status: "active",
      createdAt: now,
      lastActiveAt: now,
    };
  }

  findById(id: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  findByChatJid(chatJid: string): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE chat_jid = ? ORDER BY last_active_at DESC LIMIT 1`)
      .get(chatJid) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  findActiveByChatJid(chatJid: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM sessions WHERE chat_jid = ? AND status = 'active' ORDER BY last_active_at DESC LIMIT 1`
      )
      .get(chatJid) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  pauseSession(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE sessions SET status = 'paused', last_active_at = ? WHERE id = ?`)
      .run(now, id);
  }

  resumeSession(id: string, newChatJid: string): SessionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sessions SET chat_jid = ?, status = 'active', last_active_at = ? WHERE id = ?`
      )
      .run(newChatJid, now, id);

    const record = this.findById(id);
    if (!record) {
      throw new Error(`Failed to find resumed session ${id}`);
    }
    return record;
  }

  touchSession(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE sessions SET last_active_at = ? WHERE id = ?`).run(now, id);
  }

  listActiveSessions(): SessionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE status = 'active' ORDER BY last_active_at DESC`)
      .all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  listAllSessions(): SessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sessions`).all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: any): SessionRecord {
    return {
      id: row.id,
      chatJid: row.chat_jid,
      status: row.status,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  }
}

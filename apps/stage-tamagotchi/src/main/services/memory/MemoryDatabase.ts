import type { MemoryRecord, MemorySettings, MemoryDatabaseStats, StoreMemoryPayload, UpdateMemoryPayload } from '../../../shared/eventa/memory'

import type { SQLInputValue } from 'node:sqlite'

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Current schema version. Increment when schema changes and add migration. */
const SCHEMA_VERSION = 1

/** Default memory settings. */
const DEFAULT_SETTINGS: MemorySettings = {
  enableLongTermMemory: true,
  enableSessionSummary: true,
  enableSensitiveMemory: false,
  defaultTemporaryTTL: 86400, // 24 hours
  maxRetrievedMemories: 8,
  maxMemoryPromptTokens: 1000,
}

function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getMemoryDir(userDataPath: string): string {
  return join(userDataPath, 'memory')
}

function getMemoryDbPath(userDataPath: string): string {
  return join(getMemoryDir(userDataPath), 'memory.sqlite')
}

/**
 * Singleton database handle for the memory SQLite database.
 *
 * Opens once on app startup and stays open for the lifetime of the process.
 * All memory IPC handlers use this shared instance. Access must only
 * come from the Electron main process.
 */
let _db: DatabaseSync | null = null

export function getMemoryDatabase(userDataPath: string): DatabaseSync {
  if (_db !== null) {
    return _db
  }

  const dir = getMemoryDir(userDataPath)
  ensureDirSync(dir)

  const dbPath = getMemoryDbPath(userDataPath)
  _db = new DatabaseSync(dbPath)

  // Enable WAL mode for better concurrent read performance
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA foreign_keys=ON')
  _db.exec('PRAGMA busy_timeout=5000')

  applyMigrations(_db)
  ensureDefaultSettings(_db)

  // Memory database opened at dbPath

  return _db
}

/**
 * Closes the singleton database handle. Safe to call during app exit.
 */
export function closeMemoryDatabase(): void {
  if (_db !== null) {
    _db.close()
    _db = null
    // Memory database closed
  }
}

/**
 * Applies schema migrations from version 0 upward.
 */
function applyMigrations(db: DatabaseSync): void {
  // Create schema version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const current: { version: number } | undefined = db
    .prepare('SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined

  const currentVersion = current?.version ?? 0

  if (currentVersion >= SCHEMA_VERSION) {
    return
  }

  // Applying memory schema migrations from v${currentVersion} to v${SCHEMA_VERSION}

  // Migration: v1 — initial schema
  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        project_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('profile','preference','project','decision','relationship','episode','commitment','correction','temporary')),
        memory_key TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
        confidence REAL NOT NULL DEFAULT 0.8 CHECK(confidence >= 0 AND confidence <= 1),
        sensitive INTEGER NOT NULL DEFAULT 0,
        source_session_id TEXT,
        source_message_id TEXT,
        supersedes_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','expired','deleted')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
      CREATE INDEX IF NOT EXISTS idx_memories_memory_key ON memories(user_id, memory_key);

      -- FTS5 virtual table for full-text search on subject, content, memory_key
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        subject,
        content,
        memory_key,
        content='memories',
        content_rowid='id'
      );

      -- Triggers to keep FTS index in sync with the memories table
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, subject, content, memory_key)
        VALUES (new.id, new.subject, new.content, new.memory_key);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, subject, content, memory_key)
        VALUES ('delete', old.id, old.subject, old.content, old.memory_key);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, subject, content, memory_key)
        VALUES ('delete', old.id, old.subject, old.content, old.memory_key);
        INSERT INTO memories_fts(rowid, subject, content, memory_key)
        VALUES (new.id, new.subject, new.content, new.memory_key);
      END;

      CREATE TABLE IF NOT EXISTS memory_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        summary TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL REFERENCES memories(id),
        accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enable_long_term_memory INTEGER NOT NULL DEFAULT 1,
        enable_session_summary INTEGER NOT NULL DEFAULT 1,
        enable_sensitive_memory INTEGER NOT NULL DEFAULT 0,
        default_temporary_ttl INTEGER NOT NULL DEFAULT 86400,
        max_retrieved_memories INTEGER NOT NULL DEFAULT 8,
        max_memory_prompt_tokens INTEGER NOT NULL DEFAULT 1000
      );
    `)

    db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(1)
  }
}

function ensureDefaultSettings(db: DatabaseSync): void {
  const existing = db.prepare('SELECT id FROM memory_settings WHERE id = 1').get()
  if (!existing) {
    db.prepare(`
      INSERT INTO memory_settings (
        id, enable_long_term_memory, enable_session_summary,
        enable_sensitive_memory, default_temporary_ttl,
        max_retrieved_memories, max_memory_prompt_tokens
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      DEFAULT_SETTINGS.enableLongTermMemory ? 1 : 0,
      DEFAULT_SETTINGS.enableSessionSummary ? 1 : 0,
      DEFAULT_SETTINGS.enableSensitiveMemory ? 1 : 0,
      DEFAULT_SETTINGS.defaultTemporaryTTL,
      DEFAULT_SETTINGS.maxRetrievedMemories,
      DEFAULT_SETTINGS.maxMemoryPromptTokens,
    )
  }
}

// ---- Public API: Memory CRUD ----

/** Maps a raw DB row to a MemoryRecord. */
function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    projectId: (row.project_id as string) ?? null,
    type: row.type as MemoryRecord['type'],
    memoryKey: row.memory_key as string,
    subject: row.subject as string,
    content: row.content as string,
    importance: row.importance as number,
    confidence: row.confidence as number,
    sensitive: (row.sensitive as number) === 1,
    sourceSessionId: (row.source_session_id as string) ?? null,
    sourceMessageId: (row.source_message_id as string) ?? null,
    supersedesId: (row.supersedes_id as number) ?? null,
    status: row.status as MemoryRecord['status'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastAccessedAt: row.last_accessed_at as string,
    expiresAt: (row.expires_at as string) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) as Record<string, unknown> : null,
  }
}

export function storeMemory(db: DatabaseSync, payload: StoreMemoryPayload): MemoryRecord {
  // Consolidation: check for existing active memory with same key for this user
  const existing = db.prepare(
    'SELECT id FROM memories WHERE user_id = ? AND memory_key = ? AND status = ?',
  ).get(payload.userId, payload.memoryKey, 'active') as { id: number } | undefined

  let supersedesId: number | null = null
  if (existing) {
    supersedesId = existing.id
    db.prepare(
      'UPDATE memories SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run('superseded', existing.id)
  }

  const expiresAt = payload.ttlSeconds
    ? new Date(Date.now() + payload.ttlSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : null

  const metadataJson = payload.metadata ? JSON.stringify(payload.metadata) : null

  const result = db.prepare(`
    INSERT INTO memories (
      user_id, project_id, type, memory_key, subject, content,
      importance, confidence, sensitive,
      source_session_id, source_message_id, supersedes_id,
      expires_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.userId,
    payload.projectId ?? null,
    payload.type,
    payload.memoryKey,
    payload.subject,
    payload.content,
    payload.importance ?? 0.5,
    payload.confidence ?? 0.8,
    payload.sensitive ? 1 : 0,
    payload.sourceSessionId ?? null,
    payload.sourceMessageId ?? null,
    supersedesId,
    expiresAt,
    metadataJson,
  )

  const newId = Number(result.lastInsertRowid)
  return getMemoryById(db, newId)!
}

export function getMemoryById(db: DatabaseSync, id: number): MemoryRecord | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null

  // Update last_accessed_at
  db.prepare('UPDATE memories SET last_accessed_at = datetime(\'now\') WHERE id = ?').run(id)

  return rowToMemory(row)
}

export function updateMemory(db: DatabaseSync, payload: UpdateMemoryPayload): MemoryRecord | null {
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(payload.id) as Record<string, unknown> | undefined
  if (!existing) return null

  const updates: string[] = []
  const values: SQLInputValue[] = []

  if (payload.subject !== undefined) { updates.push('subject = ?'); values.push(payload.subject) }
  if (payload.content !== undefined) { updates.push('content = ?'); values.push(payload.content) }
  if (payload.importance !== undefined) { updates.push('importance = ?'); values.push(payload.importance) }
  if (payload.confidence !== undefined) { updates.push('confidence = ?'); values.push(payload.confidence) }
  if (payload.sensitive !== undefined) { updates.push('sensitive = ?'); values.push(payload.sensitive ? 1 : 0) }
  if (payload.type !== undefined) { updates.push('type = ?'); values.push(payload.type) }
  if (payload.metadata !== undefined) { updates.push('metadata = ?'); values.push(JSON.stringify(payload.metadata)) }

  if (updates.length === 0) return rowToMemory(existing)

  updates.push('updated_at = datetime(\'now\')')
  values.push(payload.id)

  db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  return getMemoryById(db, payload.id)
}

/**
 * Soft-deletes a memory. Marked as 'deleted' so it can be restored or excluded from FTS.
 */
export function deleteMemory(db: DatabaseSync, id: number): void {
  db.prepare(
    'UPDATE memories SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
  ).run('deleted', id)
}

/**
 * Forgets memories by keyword match using FTS5. Returns count of affected records.
 */
export function forgetMemories(db: DatabaseSync, userId: string, query: string, projectId?: string | null): number {
  // Use FTS5 to find matching memories
  const ftsQuery = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).map(w => `"${w}"`).join(' OR ')
  if (!ftsQuery) return 0

  let sql = `
    UPDATE memories SET status = 'deleted', updated_at = datetime('now')
    WHERE id IN (
      SELECT memories_fts.rowid FROM memories_fts
      WHERE memories_fts MATCH ?
    )
    AND user_id = ?
    AND status = 'active'
  `
  const params: SQLInputValue[] =[ftsQuery, userId]

  if (projectId) {
    sql += ' AND project_id = ?'
    params.push(projectId)
  }

  const result = db.prepare(sql).run(...params)
  return Number(result.changes)
}

export function forgetMemoriesByProject(db: DatabaseSync, userId: string, projectId: string): number {
  const result = db.prepare(
    'UPDATE memories SET status = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND project_id = ? AND status = ?',
  ).run('deleted', userId, projectId, 'active')
  return Number(result.changes)
}

/**
 * Lists active (non-deleted, non-expired) memories for a user.
 */
export function listActiveMemories(db: DatabaseSync, userId: string, limit: number = 50): MemoryRecord[] {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE user_id = ? AND status = 'active'
    AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(userId, now, limit) as Record<string, unknown>[]

  return rows.map(rowToMemory)
}

/**
 * Retrieves relevant memories using FTS5 text search plus scoring.
 *
 * Scoring formula:
 *   textRelevance * 0.45 + importance * 0.20 + recency * 0.15 + confidence * 0.10 + accessFrequency * 0.10
 */
export function retrieveMemories(
  db: DatabaseSync,
  userId: string,
  query: string,
  projectId?: string | null,
  maxResults: number = 8,
): MemoryRecord[] {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

  // Clean query for FTS5
  const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
  if (!cleaned) {
    // No searchable text — return recent important memories
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(userId, now, maxResults) as Record<string, unknown>[]
    return rows.map(rowToMemory)
  }

  // Use FTS5 MATCH for text search. For Chinese text, also try LIKE on subject/content.
  // FTS5 requires tokens — for CJK characters without a tokenizer configured,
  // we fall back to LIKE matching since the default tokenizer doesn't handle CJK well.
  // NOTICE:
  // The default FTS5 tokenizer (unicode61) does not segment CJK characters into tokens
  // because it treats them as ideographic characters. For Chinese keyword search to work,
  // we need a fallback using LIKE. A future migration could add a custom tokenizer or
  // switch to trigram indexing.
  const ftsWords = cleaned.split(/\s+/).filter(w => w.length > 0)
  let ftsCondition: string
  let ftsParams: SQLInputValue[]

  // If query contains CJK characters, use LIKE on subject + content instead of FTS5 MATCH
  const hasCJK = /[㐀-鿿豈-﫿]/.test(cleaned)
  if (hasCJK) {
    const likeConditions = ftsWords.map(() => '(subject LIKE ? OR content LIKE ?)')
    ftsCondition = `(${likeConditions.join(' OR ')})`
    ftsParams = ftsWords.flatMap(w => [`%${w}%`, `%${w}%`])
  }
  else {
    const ftsQuery = ftsWords.map(w => `"${w}"`).join(' OR ')
    ftsCondition = 'id IN (SELECT memories_fts.rowid FROM memories_fts WHERE memories_fts MATCH ?)'
    ftsParams = [ftsQuery]
  }

  let sql = `
    SELECT * FROM memories
    WHERE user_id = ? AND status = 'active'
    AND (expires_at IS NULL OR expires_at > ?)
    AND ${ftsCondition}
  `

  const baseParams: SQLInputValue[] = [userId, now, ...ftsParams]

  if (projectId) {
    sql += ' AND project_id = ?'
    baseParams.push(projectId)
  }

  sql += ' ORDER BY importance DESC, updated_at DESC LIMIT ?'
  baseParams.push(maxResults * 2) // Fetch more than we need, then score

  const candidates = db.prepare(sql).all(...baseParams) as Record<string, unknown>[]

  // Score and rank
  const scored = candidates.map(row => {
    const mem = rowToMemory(row)
    const recency = timeDecayScore(mem.updatedAt)
    const accessFreq = accessFrequencyScore(db, mem.id)
    // Text relevance is binary for now (matched via FTS5/LIKE)
    const textRel = 1.0
    const score = textRel * 0.45 + mem.importance * 0.20 + recency * 0.15 + mem.confidence * 0.10 + accessFreq * 0.10
    return { memory: mem, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxResults).map(s => s.memory)
}

/**
 * Search memories by optional query, type, project filters with pagination.
 */
export function searchMemories(
  db: DatabaseSync,
  userId: string,
  query?: string,
  projectId?: string | null,
  type?: string,
  limit: number = 20,
  offset: number = 0,
): MemoryRecord[] {
  const conditions: string[] = ['user_id = ?', 'status != \'deleted\'']
  const params: SQLInputValue[] =[userId]

  if (query) {
    const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
    const hasCJK = /[㐀-鿿豈-﫿]/.test(cleaned)
    if (hasCJK) {
      const words = cleaned.split(/\s+/).filter(w => w.length > 0)
      const likeConditions = words.map(() => '(subject LIKE ? OR content LIKE ?)')
      conditions.push(`(${likeConditions.join(' OR ')})`)
      words.forEach(w => { params.push(`%${w}%`); params.push(`%${w}%`) })
    }
    else {
      const ftsQuery = cleaned.split(/\s+/).filter(w => w.length > 0).map(w => `"${w}"`).join(' OR ')
      if (ftsQuery) {
        conditions.push('id IN (SELECT memories_fts.rowid FROM memories_fts WHERE memories_fts MATCH ?)')
        params.push(ftsQuery)
      }
    }
  }

  if (projectId) { conditions.push('project_id = ?'); params.push(projectId) }
  if (type) { conditions.push('type = ?'); params.push(type) }

  const sql = `
    SELECT * FROM memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `

  params.push(limit, offset)
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToMemory)
}

export function exportMemories(db: DatabaseSync, userId: string): MemoryRecord[] {
  const rows = db.prepare(
    'SELECT * FROM memories WHERE user_id = ? ORDER BY id ASC',
  ).all(userId) as Record<string, unknown>[]
  return rows.map(rowToMemory)
}

// ---- Settings ----

export function getSettings(db: DatabaseSync): MemorySettings {
  const row = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as Record<string, unknown> | undefined
  if (!row) {
    ensureDefaultSettings(db)
    return getSettings(db)
  }

  return {
    enableLongTermMemory: (row.enable_long_term_memory as number) === 1,
    enableSessionSummary: (row.enable_session_summary as number) === 1,
    enableSensitiveMemory: (row.enable_sensitive_memory as number) === 1,
    defaultTemporaryTTL: row.default_temporary_ttl as number,
    maxRetrievedMemories: row.max_retrieved_memories as number,
    maxMemoryPromptTokens: row.max_memory_prompt_tokens as number,
  }
}

export function updateSettings(db: DatabaseSync, settings: Partial<MemorySettings>): MemorySettings {
  const current = getSettings(db)
  const merged = { ...current, ...settings }

  db.prepare(`
    UPDATE memory_settings SET
      enable_long_term_memory = ?,
      enable_session_summary = ?,
      enable_sensitive_memory = ?,
      default_temporary_ttl = ?,
      max_retrieved_memories = ?,
      max_memory_prompt_tokens = ?
    WHERE id = 1
  `).run(
    merged.enableLongTermMemory ? 1 : 0,
    merged.enableSessionSummary ? 1 : 0,
    merged.enableSensitiveMemory ? 1 : 0,
    merged.defaultTemporaryTTL,
    merged.maxRetrievedMemories,
    merged.maxMemoryPromptTokens,
  )

  return merged
}

// ---- Stats ----

export function getStats(db: DatabaseSync): MemoryDatabaseStats {
  // Expire old temporary memories first
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(
    'UPDATE memories SET status = ? WHERE status = ? AND expires_at IS NOT NULL AND expires_at <= ?',
  ).run('expired', 'active', now)

  const total = (db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c
  const active = (db.prepare('SELECT COUNT(*) AS c FROM memories WHERE status = ?').get('active') as { c: number }).c
  const expired = (db.prepare('SELECT COUNT(*) AS c FROM memories WHERE status IN (?, ?)').get('expired', 'deleted') as { c: number }).c

  return { totalMemories: total, activeMemories: active, expiredMemories: expired, dbSizeBytes: 0 }
}

// ---- Scoring helpers ----

/**
 * Exponential decay score based on how recently the memory was updated.
 * Returns 0-1 where 1 means "updated right now" and ~0 means 90+ days ago.
 */
function timeDecayScore(updatedAt: string): number {
  const updated = new Date(updatedAt.replace(' ', 'T') + 'Z').getTime()
  const now = Date.now()
  const daysDiff = (now - updated) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysDiff / 30) // Half-life ~21 days
}

/**
 * Score based on access frequency: count of access_log entries in the last 30 days.
 * Normalized to 0-1 with diminishing returns.
 */
function accessFrequencyScore(db: DatabaseSync, memoryId: number): number {
  const count = (db.prepare(`
    SELECT COUNT(*) AS c FROM memory_access_log
    WHERE memory_id = ? AND accessed_at >= datetime('now', '-30 days')
  `).get(memoryId) as { c: number }).c
  return Math.min(count / 10, 1.0) // Saturates at 10 accesses
}

/**
 * Logs that a memory was accessed (for scoring purposes).
 */
export function logMemoryAccess(db: DatabaseSync, memoryId: number, source?: string): void {
  db.prepare('INSERT INTO memory_access_log (memory_id, source) VALUES (?, ?)').run(memoryId, source ?? null)
}

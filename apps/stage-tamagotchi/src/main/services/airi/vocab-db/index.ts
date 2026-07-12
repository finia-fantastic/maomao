import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { VocabStats } from '../../../../shared/eventa'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'

import { electronOpenVocabApp, electronVocabStats } from '../../../../shared/eventa'

const log = useLogg('vocab-db-service').useGlobalConfig()

type MainContext = ReturnType<typeof createContext>['context']

// NOTICE:
// Path to the external Python vocabulary app's shared SQLite database. AIRI opens it
// READ-ONLY (so it never blocks the Python app's writes) and re-opens it per query (so
// the numbers are always fresh, since the two processes share the same file). Change
// this literal if the vocab app's database moves; a future settings entry can replace it.
const WORDS_DB_PATH = 'C:\\Users\\Administrator\\Desktop\\代码\\01英语单词app\\words.db'

// The vocab app's runnable entry, in the same folder as words.db. mainv10.py is the
// current build; the other mainv*.py in that folder are dead versions. It's a tkinter
// GUI, so it's launched with `pythonw` (no console window) from its own directory.
const VOCAB_APP_ENTRY = 'mainv10.py'

const EMPTY_STATS: VocabStats = {
  total: 0,
  today: 0,
  learning: 0,
  reviewing: 0,
  mastered: 0,
  dueForReview: 0,
  recent: [],
}

/**
 * Reads a fresh snapshot of vocabulary progress from the shared `words.db`.
 *
 * The file is opened read-only and closed immediately, so this coexists with the
 * Python app writing to it. Any failure (missing file, locked, schema drift) is
 * returned via {@link VocabStats.error} instead of thrown, so the LLM tool can still
 * answer gracefully instead of surfacing an IPC rejection.
 */
function readVocabStats(dbPath: string): VocabStats {
  if (!existsSync(dbPath)) {
    return { ...EMPTY_STATS, error: `Vocabulary database not found at ${dbPath}` }
  }

  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })

    // COUNT(*) of `words` matching an optional WHERE clause.
    const count = (where?: string) =>
      (db!.prepare(`SELECT COUNT(*) AS c FROM words${where ? ` WHERE ${where}` : ''}`).get() as { c: number }).c

    // NOTE: SQLite's DATE('now') is UTC. The source Python app both stores `add_date`
    // and computes its own "today" with the same DATE('now'), so matching it here keeps
    // AIRI's "words added today" consistent with what the vocab app itself reports.
    const recent = db.prepare(
      `SELECT english, chinese, status, mastery_level AS masteryLevel FROM words ORDER BY id DESC LIMIT 10`,
    ).all() as unknown as VocabStats['recent']

    return {
      total: count(),
      today: count(`add_date = DATE('now')`),
      learning: count(`status = 'learning'`),
      reviewing: count(`status = 'reviewing'`),
      mastered: count(`status = 'mastered'`),
      dueForReview: count(`next_review IS NOT NULL AND next_review <= DATE('now')`),
      recent,
    }
  }
  catch (error) {
    log.withError(error).error('Failed to read vocabulary database')
    return { ...EMPTY_STATS, error: errorMessageFrom(error) ?? 'Failed to read vocabulary database' }
  }
  finally {
    db?.close()
  }
}

/**
 * Launches the external Python vocab app (mainv10.py) as a detached GUI process.
 *
 * Runs `pythonw mainv10.py` in the app's own folder (derived from {@link WORDS_DB_PATH})
 * so its relative paths — words.db, config.json, backgrounds — resolve. The child is
 * detached and unref'd so the vocab window outlives AIRI and never blocks it. Returns a
 * result instead of throwing so the renderer can report a missing-file / missing-Python
 * failure. `pythonw` (spawned via PATH) not being found surfaces asynchronously as a
 * logged `error` event, since a detached spawn returns before the OS resolves the binary.
 */
function openVocabApp(): { ok: boolean, error?: string } {
  const appDir = dirname(WORDS_DB_PATH)
  const entry = join(appDir, VOCAB_APP_ENTRY)
  if (!existsSync(entry)) {
    return { ok: false, error: `Vocab app entry not found at ${entry}` }
  }

  try {
    const child = spawn('pythonw', [VOCAB_APP_ENTRY], {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
      // NOTICE: force Python UTF-8 mode. mainv10.py has a top-level `print("✅ …")`;
      // under Node's spawn, Python's stdout defaults to the GBK codepage which cannot
      // encode the emoji, raising UnicodeEncodeError and crashing the app at startup.
      // PYTHONUTF8=1 makes stdout UTF-8 so the print (and the app) runs. Verified: without
      // it the spawned process exits code 1 immediately; with it, it stays up.
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    child.on('error', err => log.withError(err).error('Failed to launch vocab app'))
    child.unref()
    return { ok: true }
  }
  catch (error) {
    log.withError(error).error('Failed to launch vocab app')
    return { ok: false, error: errorMessageFrom(error) ?? 'Failed to launch vocab app' }
  }
}

/**
 * Registers the vocab-app IPC handlers on the given window context: `electronVocabStats`
 * (read the user's word-learning progress for the `get_vocabulary_progress` LLM tool) and
 * `electronOpenVocabApp` (launch the external Python vocab GUI from a controls-island
 * button). Stateless — safe to call once per window context.
 */
export function createVocabDbService(params: { context: MainContext }): void {
  defineInvokeHandler(params.context, electronVocabStats, async () => readVocabStats(WORDS_DB_PATH))
  defineInvokeHandler(params.context, electronOpenVocabApp, async () => openVocabApp())
}

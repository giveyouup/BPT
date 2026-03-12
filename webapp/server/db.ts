import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import type { MonthlyReport, Schedule, Settings, StipendMapping, CptRange } from '../src/types'
import { DEFAULT_CPT_RANGES } from '../src/utils/cptLookup'

const DATA_DIR = process.env.DATA_DIR ?? '/opt/stacks/BPT'
const DB_PATH = path.join(DATA_DIR, 'bpt.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS manual_shifts (
    date TEXT PRIMARY KEY,
    shift_types TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stipend_mappings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cpt_ranges (
    id TEXT PRIMARY KEY,
    lo INTEGER NOT NULL,
    hi INTEGER NOT NULL,
    label TEXT NOT NULL
  );
`)

function seedCptRanges() {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM cpt_ranges').get() as { count: number }
  if (count > 0) return
  const insert = db.prepare('INSERT INTO cpt_ranges (id, lo, hi, label) VALUES (?, ?, ?, ?)')
  for (const r of DEFAULT_CPT_RANGES) {
    insert.run(randomUUID(), r.lo, r.hi, r.label)
  }
}
seedCptRanges()

const DEFAULT_SETTINGS: Settings = {
  defaultPaddingMinutes: 30,
  defaultNoTimeHours: 4,
  clinicalDayStart: '06:30',
  shiftHours: { APS: 10, APS_weekend: 10, BR: 9, NIR: 10 },
  holidays: {},
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export function getReports(): MonthlyReport[] {
  return (db.prepare('SELECT data FROM reports ORDER BY id').all() as { data: string }[])
    .map((r) => JSON.parse(r.data))
}

export function getReport(id: string): MonthlyReport | undefined {
  const row = db.prepare('SELECT data FROM reports WHERE id = ?').get(id) as { data: string } | undefined
  return row ? JSON.parse(row.data) : undefined
}

export function upsertReport(report: MonthlyReport): void {
  db.prepare('INSERT OR REPLACE INTO reports (id, data) VALUES (?, ?)').run(report.id, JSON.stringify(report))
}

export function deleteReport(id: string): void {
  db.prepare('DELETE FROM reports WHERE id = ?').run(id)
}

// ─── Schedules ────────────────────────────────────────────────────────────────

export function getSchedules(): Schedule[] {
  return (db.prepare('SELECT data FROM schedules').all() as { data: string }[])
    .map((r) => JSON.parse(r.data))
    .sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
}

export function upsertSchedule(schedule: Schedule): void {
  db.prepare('INSERT OR REPLACE INTO schedules (id, data) VALUES (?, ?)').run(schedule.id, JSON.stringify(schedule))
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

// ─── Manual Shifts ────────────────────────────────────────────────────────────

export function getManualShifts(): Record<string, string[]> {
  const rows = db.prepare('SELECT date, shift_types FROM manual_shifts').all() as { date: string; shift_types: string }[]
  const result: Record<string, string[]> = {}
  for (const row of rows) result[row.date] = JSON.parse(row.shift_types)
  return result
}

export function upsertManualShift(date: string, shiftTypes: string[]): void {
  db.prepare('INSERT OR REPLACE INTO manual_shifts (date, shift_types) VALUES (?, ?)').run(date, JSON.stringify(shiftTypes))
}

export function deleteManualShift(date: string): void {
  db.prepare('DELETE FROM manual_shifts WHERE date = ?').run(date)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(): Settings {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined
  if (!row) return DEFAULT_SETTINGS
  const s = JSON.parse(row.data) as Partial<Settings>
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    shiftHours: { ...DEFAULT_SETTINGS.shiftHours, ...(s.shiftHours ?? {}) },
    holidays: s.holidays ?? {},
  }
}

export function upsertSettings(settings: Settings): void {
  db.prepare('INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(settings))
}

// ─── Stipend Mappings ─────────────────────────────────────────────────────────

export function getStipendMappings(): StipendMapping[] {
  return (db.prepare('SELECT data FROM stipend_mappings').all() as { data: string }[])
    .map((r) => JSON.parse(r.data) as StipendMapping)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
}

export function upsertStipendMapping(mapping: StipendMapping): void {
  db.prepare('INSERT OR REPLACE INTO stipend_mappings (id, data) VALUES (?, ?)').run(mapping.id, JSON.stringify(mapping))
}

export function deleteStipendMapping(id: string): void {
  db.prepare('DELETE FROM stipend_mappings WHERE id = ?').run(id)
}

// ─── CPT Ranges ───────────────────────────────────────────────────────────────

export function getCptRanges(): CptRange[] {
  return (db.prepare('SELECT id, lo, hi, label FROM cpt_ranges ORDER BY lo').all() as CptRange[])
}

export function upsertCptRange(range: CptRange): void {
  db.prepare('INSERT OR REPLACE INTO cpt_ranges (id, lo, hi, label) VALUES (?, ?, ?, ?)').run(range.id, range.lo, range.hi, range.label)
}

export function deleteCptRange(id: string): void {
  db.prepare('DELETE FROM cpt_ranges WHERE id = ?').run(id)
}

export function resetCptRanges(): void {
  db.prepare('DELETE FROM cpt_ranges').run()
  const insert = db.prepare('INSERT INTO cpt_ranges (id, lo, hi, label) VALUES (?, ?, ?, ?)')
  for (const r of DEFAULT_CPT_RANGES) {
    insert.run(randomUUID(), r.lo, r.hi, r.label)
  }
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export interface DatabaseExport {
  version: number
  exportedAt: string
  reports: MonthlyReport[]
  schedules: Schedule[]
  manualShifts: Record<string, string[]>
  settings: Settings
  stipendMappings: StipendMapping[]
  cptRanges: CptRange[]
}

export function exportDatabase(): DatabaseExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    reports: getReports(),
    schedules: getSchedules(),
    manualShifts: getManualShifts(),
    settings: getSettings(),
    stipendMappings: getStipendMappings(),
    cptRanges: getCptRanges(),
  }
}

export function importDatabase(data: DatabaseExport): void {
  // Checkpoint WAL and create a backup before wiping — stays in the same
  // DATA_DIR volume mount so it survives container restarts.
  db.pragma('wal_checkpoint(TRUNCATE)')
  const backupPath = DB_PATH + '.bak'
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, backupPath)

  const run = db.transaction(() => {
    db.prepare('DELETE FROM reports').run()
    db.prepare('DELETE FROM schedules').run()
    db.prepare('DELETE FROM manual_shifts').run()
    db.prepare('DELETE FROM settings').run()
    db.prepare('DELETE FROM stipend_mappings').run()
    db.prepare('DELETE FROM cpt_ranges').run()

    for (const report of data.reports ?? []) upsertReport(report)
    for (const schedule of data.schedules ?? []) upsertSchedule(schedule)
    for (const [date, shiftTypes] of Object.entries(data.manualShifts ?? {})) {
      upsertManualShift(date, shiftTypes)
    }
    if (data.settings) upsertSettings(data.settings)
    for (const mapping of data.stipendMappings ?? []) upsertStipendMapping(mapping)
    for (const range of data.cptRanges ?? []) upsertCptRange(range)
  })
  run()
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export interface MaintenanceResult {
  walPagesCheckpointed: number
  walPagesRemaining: number
  dbSizeBefore: number
  dbSizeAfter: number
  backupExists: boolean
}

export function runMaintenance(): MaintenanceResult {
  const dbSizeBefore = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0

  // Checkpoint: moves WAL pages into the main DB file and truncates the WAL.
  type CheckpointRow = { busy: number; log: number; checkpointed: number }
  const cpRows = db.pragma('wal_checkpoint(TRUNCATE)') as CheckpointRow[]
  const cp = cpRows[0] ?? { busy: 0, log: 0, checkpointed: 0 }

  // VACUUM: rebuilds the DB file in-place, reclaiming free pages.
  db.exec('VACUUM')

  const dbSizeAfter = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0
  const backupExists = fs.existsSync(DB_PATH + '.bak')

  return {
    walPagesCheckpointed: cp.checkpointed,
    walPagesRemaining: Math.max(0, cp.log - cp.checkpointed),
    dbSizeBefore,
    dbSizeAfter,
    backupExists,
  }
}

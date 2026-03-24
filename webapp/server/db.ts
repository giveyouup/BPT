import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import type { MonthlyReport, Schedule, Settings, StipendMapping, CptRange, Physician } from '../src/types'
import { DEFAULT_CPT_RANGES } from '../src/utils/cptLookup'

const DATA_DIR = process.env.DATA_DIR ?? '/opt/stacks/BPT'
const DB_PATH = path.join(DATA_DIR, 'bpt.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS physicians (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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

// ─── Migrations ───────────────────────────────────────────────────────────────

function addColumnIfMissing(table: string, column: string, type = 'TEXT') {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

function ensureDefaultPhysician(): string {
  const existing = db.prepare('SELECT id FROM physicians ORDER BY created_at LIMIT 1').get() as { id: string } | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare("INSERT INTO physicians (id, name, created_at) VALUES (?, ?, datetime('now'))").run(id, 'Dr. Bijan')
  return id
}

function migrateManualShiftsTable(defaultPhysicianId: string) {
  const cols = db.pragma('table_info(manual_shifts)') as { name: string }[]
  if (cols.some((c) => c.name === 'physician_id')) return
  db.exec(`
    CREATE TABLE manual_shifts_v2 (
      physician_id TEXT NOT NULL,
      date TEXT NOT NULL,
      shift_types TEXT NOT NULL,
      PRIMARY KEY (physician_id, date)
    )
  `)
  db.prepare('INSERT INTO manual_shifts_v2 (physician_id, date, shift_types) SELECT ?, date, shift_types FROM manual_shifts').run(defaultPhysicianId)
  db.exec('DROP TABLE manual_shifts')
  db.exec('ALTER TABLE manual_shifts_v2 RENAME TO manual_shifts')
}

const defaultPhysicianId = ensureDefaultPhysician()
addColumnIfMissing('reports', 'physician_id')
addColumnIfMissing('schedules', 'physician_id')
migrateManualShiftsTable(defaultPhysicianId)

// Assign orphaned rows to default physician
db.prepare('UPDATE reports SET physician_id = ? WHERE physician_id IS NULL').run(defaultPhysicianId)
db.prepare('UPDATE schedules SET physician_id = ? WHERE physician_id IS NULL').run(defaultPhysicianId)

// ─── CPT seed ─────────────────────────────────────────────────────────────────

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

// ─── Physicians ───────────────────────────────────────────────────────────────

export function getPhysicians(): Physician[] {
  return (db.prepare('SELECT id, name, created_at as createdAt FROM physicians ORDER BY created_at').all() as Physician[])
}

export function upsertPhysician(p: { id: string; name: string }): void {
  db.prepare(`
    INSERT INTO physicians (id, name, created_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name
  `).run(p.id, p.name)
}

export function deletePhysician(id: string): void {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM physicians').get() as { count: number }
  if (count <= 1) return // never delete the last physician
  db.prepare('DELETE FROM physicians WHERE id = ?').run(id)
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export function getReports(physicianId?: string): MonthlyReport[] {
  type Row = { physician_id: string; data: string }
  if (physicianId) {
    return (db.prepare('SELECT physician_id, data FROM reports WHERE physician_id = ? ORDER BY id').all(physicianId) as Row[])
      .map((r) => ({ ...JSON.parse(r.data), physicianId: r.physician_id }))
  }
  return (db.prepare('SELECT physician_id, data FROM reports ORDER BY id').all() as Row[])
    .map((r) => ({ ...JSON.parse(r.data), physicianId: r.physician_id }))
}

export function getReport(id: string): MonthlyReport | undefined {
  const row = db.prepare('SELECT data FROM reports WHERE id = ?').get(id) as { data: string } | undefined
  return row ? JSON.parse(row.data) : undefined
}

export function upsertReport(report: MonthlyReport): void {
  const physicianId = report.physicianId ?? defaultPhysicianId
  db.prepare('INSERT OR REPLACE INTO reports (id, physician_id, data) VALUES (?, ?, ?)').run(report.id, physicianId, JSON.stringify(report))
}

export function deleteReport(id: string): void {
  db.prepare('DELETE FROM reports WHERE id = ?').run(id)
}

// ─── Schedules ────────────────────────────────────────────────────────────────

export function getSchedules(physicianId?: string): Schedule[] {
  type Row = { physician_id: string; data: string }
  if (physicianId) {
    return (db.prepare('SELECT physician_id, data FROM schedules WHERE physician_id = ?').all(physicianId) as Row[])
      .map((r) => ({ ...JSON.parse(r.data), physicianId: r.physician_id }))
      .sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
  }
  return (db.prepare('SELECT physician_id, data FROM schedules').all() as Row[])
    .map((r) => ({ ...JSON.parse(r.data), physicianId: r.physician_id }))
    .sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
}

export function upsertSchedule(schedule: Schedule): void {
  const physicianId = schedule.physicianId ?? defaultPhysicianId
  db.prepare('INSERT OR REPLACE INTO schedules (id, physician_id, data) VALUES (?, ?, ?)').run(schedule.id, physicianId, JSON.stringify(schedule))
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

// ─── Manual Shifts ────────────────────────────────────────────────────────────

export function getManualShifts(physicianId: string): Record<string, string[]> {
  const rows = db.prepare('SELECT date, shift_types FROM manual_shifts WHERE physician_id = ?').all(physicianId) as { date: string; shift_types: string }[]
  const result: Record<string, string[]> = {}
  for (const row of rows) result[row.date] = JSON.parse(row.shift_types)
  return result
}

export function upsertManualShift(physicianId: string, date: string, shiftTypes: string[]): void {
  db.prepare('INSERT OR REPLACE INTO manual_shifts (physician_id, date, shift_types) VALUES (?, ?, ?)').run(physicianId, date, JSON.stringify(shiftTypes))
}

export function deleteManualShift(physicianId: string, date: string): void {
  db.prepare('DELETE FROM manual_shifts WHERE physician_id = ? AND date = ?').run(physicianId, date)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(): Settings {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined
  if (!row) return DEFAULT_SETTINGS
  const s = JSON.parse(row.data) as Partial<Settings>
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    shiftHours: s.shiftHours ?? DEFAULT_SETTINGS.shiftHours,
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
  physicians: Physician[]
  reports: MonthlyReport[]
  schedules: Schedule[]
  manualShifts: Record<string, Record<string, string[]>> // physicianId -> date -> shiftTypes
  settings: Settings
  stipendMappings: StipendMapping[]
  cptRanges: CptRange[]
}

export function exportDatabase(): DatabaseExport {
  const physicians = getPhysicians()
  const manualShifts: Record<string, Record<string, string[]>> = {}
  for (const p of physicians) {
    manualShifts[p.id] = getManualShifts(p.id)
  }
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    physicians,
    reports: getReports(),
    schedules: getSchedules(),
    manualShifts,
    settings: getSettings(),
    stipendMappings: getStipendMappings(),
    cptRanges: getCptRanges(),
  }
}

export function importDatabase(data: DatabaseExport): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const backupPath = DB_PATH + '.bak'
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, backupPath)

  const run = db.transaction(() => {
    db.prepare('DELETE FROM physicians').run()
    db.prepare('DELETE FROM reports').run()
    db.prepare('DELETE FROM schedules').run()
    db.prepare('DELETE FROM manual_shifts').run()
    db.prepare('DELETE FROM settings').run()
    db.prepare('DELETE FROM stipend_mappings').run()
    db.prepare('DELETE FROM cpt_ranges').run()

    for (const physician of data.physicians ?? []) upsertPhysician(physician)
    for (const report of data.reports ?? []) upsertReport(report)
    for (const schedule of data.schedules ?? []) upsertSchedule(schedule)

    // Handle both old format (flat Record<date, shiftTypes>) and new (nested by physicianId)
    const ms = data.manualShifts ?? {}
    const firstVal = Object.values(ms)[0]
    if (firstVal && !Array.isArray(firstVal)) {
      // New format: keyed by physicianId
      for (const [pid, shifts] of Object.entries(ms as Record<string, Record<string, string[]>>)) {
        for (const [date, shiftTypes] of Object.entries(shifts)) {
          upsertManualShift(pid, date, shiftTypes)
        }
      }
    } else {
      // Old format: flat date -> shiftTypes, assign to default physician
      const pid = data.physicians?.[0]?.id ?? defaultPhysicianId
      for (const [date, shiftTypes] of Object.entries(ms as unknown as Record<string, string[]>)) {
        upsertManualShift(pid, date, shiftTypes)
      }
    }

    if (data.settings) upsertSettings(data.settings)
    for (const mapping of data.stipendMappings ?? []) upsertStipendMapping(mapping)
    for (const range of data.cptRanges ?? []) upsertCptRange(range)
  })
  run()
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export interface MaintenanceResult {
  walBusy: boolean
  walPagesCheckpointed: number
  walPagesRemaining: number
  dbSizeBefore: number
  dbSizeAfter: number
  backupExists: boolean
}

export function runMaintenance(): MaintenanceResult {
  const dbSizeBefore = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0

  type CheckpointRow = { busy: number; log: number; checkpointed: number }

  // Pre-VACUUM checkpoint (optional but reduces WAL work during VACUUM)
  db.pragma('wal_checkpoint(TRUNCATE)')

  // VACUUM rewrites the entire database through the WAL in WAL mode,
  // so a second checkpoint is required to flush and truncate it afterwards.
  db.exec('VACUUM')

  const cpRows = db.pragma('wal_checkpoint(TRUNCATE)') as CheckpointRow[]
  const cp = cpRows[0] ?? { busy: 0, log: 0, checkpointed: 0 }

  const dbSizeAfter = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0
  const backupExists = fs.existsSync(DB_PATH + '.bak')

  return {
    walBusy: cp.busy === 1,
    walPagesCheckpointed: cp.checkpointed,
    walPagesRemaining: Math.max(0, cp.log - cp.checkpointed),
    dbSizeBefore,
    dbSizeAfter,
    backupExists,
  }
}

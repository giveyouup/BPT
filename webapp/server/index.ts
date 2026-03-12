import express from 'express'
import path from 'path'
import {
  getReports, getReport, upsertReport, deleteReport,
  getSchedules, upsertSchedule, deleteSchedule,
  getManualShifts, upsertManualShift, deleteManualShift,
  getSettings, upsertSettings,
  getStipendMappings, upsertStipendMapping, deleteStipendMapping,
  getCptRanges, upsertCptRange, deleteCptRange as deleteCptRangeDb, resetCptRanges,
  exportDatabase, importDatabase,
} from './db'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(express.json({ limit: '50mb' }))

// ─── Reports ──────────────────────────────────────────────────────────────────

app.get('/api/reports', (_req, res) => res.json(getReports()))

app.get('/api/reports/:id', (req, res) => {
  const r = getReport(req.params.id)
  r ? res.json(r) : res.status(404).json({ error: 'Not found' })
})

app.put('/api/reports/:id', (req, res) => {
  upsertReport(req.body)
  res.json({ ok: true })
})

app.delete('/api/reports/:id', (req, res) => {
  deleteReport(req.params.id)
  res.json({ ok: true })
})

// ─── Schedules ────────────────────────────────────────────────────────────────

app.get('/api/schedules', (_req, res) => res.json(getSchedules()))

app.put('/api/schedules/:id', (req, res) => {
  upsertSchedule(req.body)
  res.json({ ok: true })
})

app.delete('/api/schedules/:id', (req, res) => {
  deleteSchedule(req.params.id)
  res.json({ ok: true })
})

// ─── Manual Shifts ────────────────────────────────────────────────────────────

app.get('/api/manual-shifts', (_req, res) => res.json(getManualShifts()))

app.put('/api/manual-shifts/:date', (req, res) => {
  upsertManualShift(req.params.date, req.body.shiftTypes ?? [])
  res.json({ ok: true })
})

app.delete('/api/manual-shifts/:date', (req, res) => {
  deleteManualShift(req.params.date)
  res.json({ ok: true })
})

// ─── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => res.json(getSettings()))

app.put('/api/settings', (req, res) => {
  upsertSettings(req.body)
  res.json({ ok: true })
})

// ─── Stipend Mappings ─────────────────────────────────────────────────────────

app.get('/api/stipend-mappings', (_req, res) => res.json(getStipendMappings()))

app.put('/api/stipend-mappings/:id', (req, res) => {
  upsertStipendMapping(req.body)
  res.json({ ok: true })
})

app.delete('/api/stipend-mappings/:id', (req, res) => {
  deleteStipendMapping(req.params.id)
  res.json({ ok: true })
})

// ─── CPT Ranges ───────────────────────────────────────────────────────────────
app.get('/api/cpt-ranges', (_req, res) => res.json(getCptRanges()))

app.put('/api/cpt-ranges/:id', (req, res) => {
  upsertCptRange(req.body)
  res.json({ ok: true })
})

app.delete('/api/cpt-ranges/:id', (req, res) => {
  deleteCptRangeDb(req.params.id)
  res.json({ ok: true })
})

app.post('/api/cpt-ranges/reset', (_req, res) => {
  resetCptRanges()
  res.json(getCptRanges())
})

// ─── Export / Import ──────────────────────────────────────────────────────────

app.get('/api/export', (_req, res) => {
  const data = exportDatabase()
  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Disposition', `attachment; filename="bpt-backup-${date}.json"`)
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(data, null, 2))
})

app.post('/api/import', (req, res) => {
  try {
    const data = req.body
    if (!data || !data.version || !Array.isArray(data.reports)) {
      return res.status(400).json({ error: 'Invalid backup file — missing required fields.' })
    }
    importDatabase(data)
    res.json({ ok: true })
  } catch (err) {
    console.error('Import failed:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ─── Serve static frontend ────────────────────────────────────────────────────

const distPath = path.resolve(process.cwd(), 'dist')
app.use(express.static(distPath))
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))

app.listen(PORT, () => console.log(`BPT server running on port ${PORT}`))

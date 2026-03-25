import express from 'express'
import path from 'path'
import {
  getPhysicians, upsertPhysician, deletePhysician,
  getReports, getReport, upsertReport, deleteReport,
  getSchedules, upsertSchedule, deleteSchedule,
  getManualShifts, upsertManualShift, deleteManualShift,
  getSettings, upsertSettings,
  getStipendMappings, upsertStipendMapping, deleteStipendMapping,
  getCptRanges, upsertCptRange, deleteCptRange as deleteCptRangeDb, resetCptRanges,
  getMonthlyExpenses, upsertMonthlyExpenses, deleteMonthlyExpenses,
  getAnnualExpenses, upsertAnnualExpenses, deleteAnnualExpenses,
  exportDatabase, importDatabase, runMaintenance,
} from './db'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(express.json({ limit: '50mb' }))

// ─── Physicians ────────────────────────────────────────────────────────────────

app.get('/api/physicians', (_req, res) => res.json(getPhysicians()))

app.put('/api/physicians/:id', (req, res) => {
  upsertPhysician({ id: req.params.id, name: req.body.name })
  res.json({ ok: true })
})

app.delete('/api/physicians/:id', (req, res) => {
  deletePhysician(req.params.id)
  res.json({ ok: true })
})

// ─── Reports ──────────────────────────────────────────────────────────────────

app.get('/api/reports', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  res.json(getReports(physicianId))
})

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

app.get('/api/schedules', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  res.json(getSchedules(physicianId))
})

app.put('/api/schedules/:id', (req, res) => {
  upsertSchedule(req.body)
  res.json({ ok: true })
})

app.delete('/api/schedules/:id', (req, res) => {
  deleteSchedule(req.params.id)
  res.json({ ok: true })
})

// ─── Manual Shifts ────────────────────────────────────────────────────────────

app.get('/api/manual-shifts', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  res.json(getManualShifts(physicianId))
})

app.put('/api/manual-shifts/:date', (req, res) => {
  const physicianId = req.body.physicianId
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  upsertManualShift(physicianId, req.params.date, req.body.shiftTypes ?? [])
  res.json({ ok: true })
})

app.delete('/api/manual-shifts/:date', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  deleteManualShift(physicianId, req.params.date)
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

// ─── Monthly Expenses ─────────────────────────────────────────────────────────

app.get('/api/expenses', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  res.json(getMonthlyExpenses(physicianId))
})

app.put('/api/expenses/:id', (req, res) => {
  upsertMonthlyExpenses(req.body)
  res.json({ ok: true })
})

app.delete('/api/expenses/:id', (req, res) => {
  deleteMonthlyExpenses(req.params.id)
  res.json({ ok: true })
})

// ─── Annual Expenses ──────────────────────────────────────────────────────────

app.get('/api/annual-expenses', (req, res) => {
  res.json(getAnnualExpenses(req.query.physicianId as string | undefined))
})
app.put('/api/annual-expenses/:id', (req, res) => {
  upsertAnnualExpenses(req.body)
  res.json({ ok: true })
})
app.delete('/api/annual-expenses/:id', (req, res) => {
  deleteAnnualExpenses(req.params.id)
  res.json({ ok: true })
})

// ─── DB Maintenance ───────────────────────────────────────────────────────────

app.post('/api/db/maintenance', (_req, res) => {
  try {
    res.json(runMaintenance())
  } catch (err) {
    console.error('Maintenance failed:', err)
    res.status(500).json({ error: String(err) })
  }
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

app.listen(PORT, () => {
  console.log(`BPT server running on port ${PORT}`)
  scheduleMaintenance()
})

// ─── Scheduled maintenance ────────────────────────────────────────────────────

function scheduleMaintenance() {
  const intervalHours = parseFloat(process.env.MAINTENANCE_INTERVAL_HOURS ?? '24')
  if (!isFinite(intervalHours) || intervalHours <= 0) {
    console.log('Scheduled maintenance disabled (MAINTENANCE_INTERVAL_HOURS <= 0)')
    return
  }
  const intervalMs = intervalHours * 60 * 60 * 1000

  const run = () => {
    try {
      const result = runMaintenance()
      const freed = ((result.dbSizeBefore - result.dbSizeAfter) / 1024).toFixed(1)
      console.log(
        `[maintenance] WAL checkpointed=${result.walPagesCheckpointed} remaining=${result.walPagesRemaining}` +
        ` db=${(result.dbSizeAfter / 1024 / 1024).toFixed(2)}MB freed=${freed}KB`
      )
    } catch (err) {
      console.error('[maintenance] Failed:', err)
    }
  }

  setTimeout(() => {
    run()
    setInterval(run, intervalMs)
  }, 60_000)

  console.log(`Scheduled maintenance every ${intervalHours}h (first run in 60s)`)
}

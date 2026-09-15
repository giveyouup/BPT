import express from 'express'
import multer from 'multer'
import path from 'path'
import { detectPcrSections, extractPcrLineItems } from './pdfParser'
import { parseSchedulePdf } from './schedulePdfParser'
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
  getPcrIncomeStatements, upsertPcrIncomeStatement, deletePcrIncomeStatement,
  getPcrCategoryMappings, upsertPcrCategoryMapping, deletePcrCategoryMapping, resetPcrCategoryMappings,
  exportDatabase, importDatabase, runMaintenance,
} from './db'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

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
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  const r = getReport(req.params.id, physicianId)
  r ? res.json(r) : res.status(404).json({ error: 'Not found' })
})

app.put('/api/reports/:id', (req, res) => {
  upsertReport(req.body)
  res.json({ ok: true })
})

app.delete('/api/reports/:id', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  deleteReport(req.params.id, physicianId)
  res.json({ ok: true })
})

// ─── PCR PDF import (OCR) ───────────────────────────────────────────────────────
//
// PCR reports are sometimes only available as scanned PDFs (no text layer)
// rather than the native .xlsx export, often bundled with unrelated pages.
// These endpoints shell out to the vendored Python/Tesseract OCR pipeline
// (server/pcr-pdf/parse_pcr_pdf.py) to locate the report pages and extract
// LineItem-shaped data, mirroring what the client-side xlsx parser produces.

app.post('/api/pcr-pdf/detect', pdfUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const result = await detectPcrSections(req.file.buffer)
    res.json(result)
  } catch (err) {
    console.error('PDF detect failed:', err)
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/pcr-pdf/extract', pdfUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const pages = req.body.pages as string | undefined
  if (!pages) return res.status(400).json({ error: 'pages is required' })
  try {
    const result = await extractPcrLineItems(req.file.buffer, pages)
    res.json(result)
  } catch (err) {
    console.error('PDF extract failed:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ─── Schedule PDF import ────────────────────────────────────────────────────────
//
// The monthly schedule is published as a wide grid PDF (physicians as rows,
// days as columns). Shells out to server/schedule-pdf/parse_schedule_pdf.py,
// which reads the PDF's embedded text layer directly (no OCR) and returns
// every detected physician row so the client can pick one.

app.post('/api/schedule-pdf/parse', pdfUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const result = await parseSchedulePdf(req.file.buffer)
    res.json(result)
  } catch (err) {
    console.error('Schedule PDF parse failed:', err)
    res.status(500).json({ error: String(err) })
  }
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
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  deleteMonthlyExpenses(req.params.id, physicianId)
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
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  deleteAnnualExpenses(req.params.id, physicianId)
  res.json({ ok: true })
})

// ─── PCR Income Statements ─────────────────────────────────────────────────────

app.get('/api/pcr-income-statements', (req, res) => {
  res.json(getPcrIncomeStatements(req.query.physicianId as string | undefined))
})
app.put('/api/pcr-income-statements/:id', (req, res) => {
  upsertPcrIncomeStatement(req.body)
  res.json({ ok: true })
})
app.delete('/api/pcr-income-statements/:id', (req, res) => {
  const physicianId = req.query.physicianId as string | undefined
  if (!physicianId) return res.status(400).json({ error: 'physicianId required' })
  deletePcrIncomeStatement(req.params.id, physicianId)
  res.json({ ok: true })
})

// ─── PCR Category Mappings ──────────────────────────────────────────────────────

app.get('/api/pcr-category-mappings', (_req, res) => res.json(getPcrCategoryMappings()))
app.put('/api/pcr-category-mappings/:id', (req, res) => {
  upsertPcrCategoryMapping(req.body)
  res.json({ ok: true })
})
app.delete('/api/pcr-category-mappings/:id', (req, res) => {
  deletePcrCategoryMapping(req.params.id)
  res.json({ ok: true })
})
app.post('/api/pcr-category-mappings/reset', (req, res) => {
  const section = req.query.section as 'stipend' | 'expense' | 'otherIncome' | undefined
  if (section !== 'stipend' && section !== 'expense' && section !== 'otherIncome') {
    return res.status(400).json({ error: 'section must be "stipend", "expense", or "otherIncome"' })
  }
  res.json(resetPcrCategoryMappings(section))
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

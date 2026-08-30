import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

// See pdfParser.ts for why this is resolved relative to cwd rather than
// __dirname/import.meta.url. The Dockerfile copies server/schedule-pdf/ to
// dist-server/server/schedule-pdf/ to match the prod candidate below.
const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'server', 'schedule-pdf', 'parse_schedule_pdf.py'),
  path.join(process.cwd(), 'dist-server', 'server', 'schedule-pdf', 'parse_schedule_pdf.py'),
]
const SCRIPT_PATH =
  process.env.SCHEDULE_PDF_SCRIPT ?? SCRIPT_CANDIDATES.find((p) => fs.existsSync(p)) ?? SCRIPT_CANDIDATES[0]
const PYTHON_BIN = process.env.SCHEDULE_PDF_PYTHON ?? process.env.PCR_PDF_PYTHON ?? 'python3'
const TIMEOUT_MS = 60 * 1000 // pure text-layer parsing -- no OCR, should be near-instant
const MAX_BUFFER = 20 * 1024 * 1024

export interface SchedulePdfRow {
  name: string
  shifts: string[]
}

export interface SchedulePdfResult {
  month: number | null
  year: number | null
  sourcePage: number
  rows: SchedulePdfRow[]
}

async function withTempPdf<T>(buffer: Buffer, fn: (tmpPath: string) => Promise<T>): Promise<T> {
  const tmpPath = path.join(os.tmpdir(), `schedule-pdf-${randomUUID()}.pdf`)
  fs.writeFileSync(tmpPath, buffer)
  try {
    return await fn(tmpPath)
  } finally {
    fs.unlink(tmpPath, () => {})
  }
}

function runPython(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [SCRIPT_PATH, ...args],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message))
          return
        }
        const jsonStart = stdout.indexOf('{')
        if (jsonStart === -1) {
          reject(new Error('Schedule PDF parser produced no output'))
          return
        }
        try {
          resolve(JSON.parse(stdout.slice(jsonStart)))
        } catch (e) {
          reject(new Error(`Failed to parse schedule PDF parser output: ${(e as Error).message}`))
        }
      }
    )
  })
}

export function parseSchedulePdf(buffer: Buffer): Promise<SchedulePdfResult> {
  return withTempPdf(buffer, (tmpPath) => runPython([tmpPath, '--json']))
}

import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

// Locate the vendored Python OCR script relative to the working directory
// rather than __dirname/import.meta.url: dev runs this file directly via tsx
// under package.json's "type": "module" (where __dirname is unavailable and
// tsc's CommonJS target rejects import.meta), while prod runs the tsc-compiled
// CommonJS output. cwd is well-known and stable in both: `webapp/` in dev
// (npm run dev:server), `/app` in prod (Dockerfile WORKDIR + `node
// dist-server/server/index.js`), which is where the Dockerfile also copies
// server/pcr-pdf/ to (dist-server/server/pcr-pdf/).
const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), 'server', 'pcr-pdf', 'parse_pcr_pdf.py'),
  path.join(process.cwd(), 'dist-server', 'server', 'pcr-pdf', 'parse_pcr_pdf.py'),
]
const SCRIPT_PATH =
  process.env.PCR_PDF_SCRIPT ?? SCRIPT_CANDIDATES.find((p) => fs.existsSync(p)) ?? SCRIPT_CANDIDATES[0]
const PYTHON_BIN = process.env.PCR_PDF_PYTHON ?? 'python3'
const TIMEOUT_MS = 5 * 60 * 1000 // OCR is ~2-3s/page; generous ceiling for large bundles
const MAX_BUFFER = 50 * 1024 * 1024

export interface PcrSection {
  startPage: number
  endPage: number
  doctorName: string
}

export interface PcrDetectResult {
  pageCount: number
  sections: PcrSection[]
}

export interface PcrLineItem {
  incidentId: string
  serviceDate: string
  ticketNum: string
  cptAsa: string
  modifier: string
  unitValue: number | null
  distributionValue: number
  startTime: string | null
  endTime: string | null
  totalTime: string | null
  timeUnits: number
  totalDistributableUnits: number
}

export interface PcrUnitInfo {
  unitDollarValue: number
  unitCorrection: number
  reconciled: boolean
}

export interface PcrPrintedTotals {
  distributableUnits: number
  totalDistribUnits: number
}

export interface PcrStatementLine {
  label: string
  section: 'stipend' | 'expense' | 'otherIncome' | 'other'
  amount: number
}

export interface PcrIncomeStatementMonth {
  year: number
  month: number
  lines: PcrStatementLine[]
}

export interface PcrExtractResult {
  doctorName: string
  criteria: Record<string, string>
  lineItems: PcrLineItem[]
  unitInfo: PcrUnitInfo | null
  printedTotals: PcrPrintedTotals | null
  incomeStatement: PcrIncomeStatementMonth[]
}

async function withTempPdf<T>(buffer: Buffer, fn: (tmpPath: string) => Promise<T>): Promise<T> {
  const tmpPath = path.join(os.tmpdir(), `pcr-pdf-${randomUUID()}.pdf`)
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
        // Defensive: tolerate a stray warning line some dependency might print
        // to stdout ahead of the JSON payload -- parse from the first '{'.
        const jsonStart = stdout.indexOf('{')
        if (jsonStart === -1) {
          reject(new Error('PDF parser produced no output'))
          return
        }
        try {
          resolve(JSON.parse(stdout.slice(jsonStart)))
        } catch (e) {
          reject(new Error(`Failed to parse PDF parser output: ${(e as Error).message}`))
        }
      }
    )
  })
}

export function detectPcrSections(buffer: Buffer): Promise<PcrDetectResult> {
  return withTempPdf(buffer, (tmpPath) => runPython(['detect', tmpPath]))
}

export function extractPcrLineItems(buffer: Buffer, pages: string): Promise<PcrExtractResult> {
  return withTempPdf(buffer, (tmpPath) => runPython(['extract', tmpPath, '--pages', pages, '--json']))
}

import fs from 'fs'
import path from 'path'
import { DATA_DIR } from './db'

// Source PCR PDFs are kept next to the database so flagged OCR cells can be
// re-cropped for review long after the upload:
//   <DATA_DIR>/pdfs/<physician name>/<year>/<YYYY-MM>_<original filename>
// A report records its file as a path relative to pdfs/, so renaming a
// physician later doesn't orphan anything.
export const PDF_DIR = path.join(DATA_DIR, 'pdfs')

function safeSegment(s: string, fallback: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100)
  return cleaned || fallback
}

/** Saves a PDF and returns its path relative to PDF_DIR. Replaces any earlier file stored for the same physician + month. */
export function storePcrPdf(buffer: Buffer, physicianName: string, year: number, month: number, filename: string): string {
  const id = `${year}-${String(month).padStart(2, '0')}`
  const dir = path.join(PDF_DIR, safeSegment(physicianName, 'unknown'), String(year))
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${id}_`)) fs.unlinkSync(path.join(dir, f))
  }
  const base = safeSegment(path.basename(filename), 'report.pdf')
  const name = `${id}_${base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`}`
  fs.writeFileSync(path.join(dir, name), buffer)
  return path.relative(PDF_DIR, path.join(dir, name)).split(path.sep).join('/')
}

/** Resolves a stored relative path to an absolute one, or null if it escapes PDF_DIR or doesn't exist. */
export function resolveStoredPdf(rel: string): string | null {
  const abs = path.resolve(PDF_DIR, rel)
  if (!abs.startsWith(PDF_DIR + path.sep)) return null
  return fs.existsSync(abs) ? abs : null
}

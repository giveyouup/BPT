#!/usr/bin/env python3
"""Convert a Central Anesthesia Service Exchange 'Case Distribution Report'
PDF (scanned/rasterized, no text layer) into structured line-item data.

Vendored from ~/Documents/PDFTool/pdf_to_xlsx.py for BPT's PDF-upload
integration (webapp/server/pdfParser.ts shells out to this script). The core
OCR/extraction logic is unchanged and has been validated against several
real report/xlsx pairs; this copy adds `detect` (find report page ranges in
a bundled PDF) and `extract --json` (emit LineItem-shaped JSON) subcommands
for the server integration, alongside the original `xlsx` subcommand for
standalone CLI use.

Usage:
    python3 parse_pcr_pdf.py detect INPUT.pdf
    python3 parse_pcr_pdf.py extract INPUT.pdf --pages 6-10 --json
    python3 parse_pcr_pdf.py xlsx INPUT.pdf -o OUTPUT.xlsx --pages 6-10
"""
import argparse
import json
import re
import sys

import pymupdf as fitz
import pytesseract
from pytesseract import Output
from PIL import Image
import openpyxl
from openpyxl.styles import Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ZOOM = 4
PAGE_PT_WIDTH = 792.0

COLUMNS = [
    "Incident ID", "Service Dt", "Ticket Num", "CPT/ASA", "Modifier",
    "Unit Value", "Value", "Age Value", "Start Time", "End Time",
    "Total Time", "Distributable Time Units", "Total Distrib Units",
]

# Left-edge anchors for each column's content, calibrated in PDF points
# (page width 792pt) from the report template. This layout is generated
# programmatically (iTextSharp) so it is pixel-identical across pages/documents
# from this source system.
COLUMN_ANCHORS_PT = [38.0, 105.75, 168.5, 233.75, 302.0, 393.5, 451.75,
                      500.75, 524.5, 568.25, 604.75, 679.5, 739.0]

HEADER_CUTOFF_PT = 120.0  # strip the repeating title/column-header block on every page
ROW_TOL_PT = 6.0
DETECT_BAND_PT = 150.0    # top-of-page band scanned by `detect` (title + doctor-name row)
DETECT_ZOOM = 2.0         # lower zoom for the cheap per-page pre-scan

KNOWN_MODIFIERS = [
    "AA", "ET", "RT", "LT", "26", "59", "AAQS", "AAQSPT", "AA78",
    "AG59", "AG59LT", "AG59RT", "59LT", "59RT", "AAET", "AAQS33",
]

# ─── "Physician 12 Month Summary" / "<MON> Corrections" bonus pages ───────────
# Bundled alongside the Case Distribution Report in some CASE exports. Both
# are portrait Letter pages (612x792pt), a different layout/orientation than
# the landscape line-items table above.

BONUS_PAGE_PT_SIZE = (612.0, 792.0)
MONTH_ABBR3 = ["jan", "feb", "mar", "apr", "may", "jun",
               "jul", "aug", "sep", "oct", "nov", "dec"]

SUMMARY_ROW_RE = re.compile(
    r"^([A-Za-z]{3})-(\d{2})\s+([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})$"
)
MONTH_SUMMARY_TITLE_RE = re.compile(r"\d{1,2}\s*month\s*summary", re.IGNORECASE)
CORRECTIONS_TITLE_RE = re.compile(r"\bcorrections?\b", re.IGNORECASE)
ACCT_DATE_RE = re.compile(r"\b(\d{1,2})\s*/\s*(\d{4})\b")

# Fixed anchor for the "PCR CORRECTION" row's value cell on the Corrections
# page, calibrated against real samples the same way COLUMN_ANCHORS_PT is for
# the line-items table -- this report family is template-generated, so the
# position is consistent across documents. The cell is boxed in a red border
# that badly confuses tesseract's binarization; red pixels are scrubbed to
# white (see `read_correction_value`) before OCR rather than trying to crop
# it out pixel-perfectly.
CORRECTION_VALUE_RECT_PT = (500.0, 200.0, 612.0, 214.0)


def column_bounds_pt():
    bounds = [0.0]
    for a, b in zip(COLUMN_ANCHORS_PT, COLUMN_ANCHORS_PT[1:]):
        bounds.append((a + b) / 2)
    bounds.append(PAGE_PT_WIDTH)
    return bounds


BOUNDS = column_bounds_pt()


def render_page(doc, index, zoom=ZOOM, clip_pt=None):
    page = doc[index]
    mat = fitz.Matrix(zoom, zoom)
    clip = fitz.Rect(0, 0, PAGE_PT_WIDTH, clip_pt) if clip_pt else None
    pix = page.get_pixmap(matrix=mat, clip=clip)
    mode = "RGB" if pix.n < 4 else "RGBA"
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


def ocr_words(img, zoom=ZOOM):
    data = pytesseract.image_to_data(img, output_type=Output.DICT, config="--psm 6")
    words = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if not text:
            continue
        conf = float(data["conf"][i])
        if conf < 10:
            continue
        words.append({
            "text": text,
            "left": data["left"][i] / zoom,
            "top": data["top"][i] / zoom,
            "width": data["width"][i] / zoom,
            "conf": conf,
        })
    return words


def group_rows(words, tol=ROW_TOL_PT):
    words = sorted(words, key=lambda w: (w["top"], w["left"]))
    rows = []
    for w in words:
        for row in rows:
            if abs(row["top"] - w["top"]) <= tol:
                row["words"].append(w)
                row["top"] = (row["top"] * row["n"] + w["top"]) / (row["n"] + 1)
                row["n"] += 1
                break
        else:
            rows.append({"top": w["top"], "n": 1, "words": [w]})
    rows.sort(key=lambda r: r["top"])
    for r in rows:
        r["words"].sort(key=lambda w: w["left"])
    return rows


# Calibrated directly against 21 real pages across 5 different source PDFs:
# the gap from HEADER_CUTOFF_PT to the first body row is *always* 6.0-7.5pt,
# and the gap between two consecutive rows is *always* ~12.25pt -- except
# the legitimate ~19.7-21.3pt gap immediately before the repeating copyright
# footer row, which is excluded explicitly below (by content, not fudged
# via threshold) rather than risking a too-tight margin against it.
HEADER_TO_FIRST_ROW_GAP_PT = 7.5
ROW_TO_ROW_GAP_PT = 12.25


def _looks_like_footer(row_words):
    text = " ".join(w["text"] for w in row_words)
    return "PHIMED" in text.upper() or text.strip().startswith("©")


def recover_missed_rows(page_img, rows, zoom, start_boundary=HEADER_CUTOFF_PT,
                         header_gap_pt=HEADER_TO_FIRST_ROW_GAP_PT, row_gap_pt=ROW_TO_ROW_GAP_PT):
    """tesseract's whole-page line-segmentation occasionally drops an entire
    row even though its pixels are perfectly legible in isolation --
    confirmed directly on two real samples now (a Case Distribution Report
    row, and separately a whole "EXPENSES" section-header row on an income
    statement page) where the row was invisible to the full-page OCR pass
    but read correctly on the first try once that exact band was cropped
    and re-OCR'd alone. Detects any gap noticeably wider than the expected
    per-page-type row spacing (either from `start_boundary` to the first
    row, or between two consecutive rows) and re-scans just that band. A
    false-positive re-scan is harmless here: if nothing is actually there,
    tesseract finds no words and the gap is left as-is; if it finds noise,
    the caller's own row classification already discards anything that
    doesn't look like a real data/header row.

    Defaults are calibrated for the Case Distribution Report table (21
    real pages, 5 PDFs: header-to-first-row gap 6.0-7.5pt, row-to-row
    ~12.25pt); pass `start_boundary`/`header_gap_pt`/`row_gap_pt` for a
    differently-spaced page (the income statement's rows run ~13.7pt
    apart, including from its own header row to the first body row)."""
    if not rows:
        return rows
    sorted_rows = sorted(rows, key=lambda r: r["top"])
    boundaries = [(start_boundary, header_gap_pt * 1.7, sorted_rows[0])]
    boundaries += [
        (a["top"], row_gap_pt * 1.6, b)
        for a, b in zip(sorted_rows, sorted_rows[1:])
    ]

    recovered = []
    for start, threshold, next_row in boundaries:
        end = next_row["top"]
        if end - start < threshold or _looks_like_footer(next_row["words"]):
            continue
        band_top, band_bottom = start + 1.0, end - 1.0
        if band_bottom - band_top < 4.0:
            continue
        crop = page_img.crop((0, int(band_top * zoom), page_img.width, int(band_bottom * zoom)))
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
        found = ocr_words(crop, zoom=zoom * 2)
        if not found:
            continue
        for w in found:
            w["top"] += band_top
        recovered.append({
            "top": sum(w["top"] for w in found) / len(found),
            "n": len(found),
            "words": sorted(found, key=lambda w: w["left"]),
        })

    if not recovered:
        return rows
    return sorted(rows + recovered, key=lambda r: r["top"])


def bin_row_to_columns(row_words):
    cells = ["" for _ in COLUMNS]
    confs = [None for _ in COLUMNS]
    for w in row_words:
        cx = w["left"] + w["width"] / 2
        for i in range(len(COLUMNS)):
            if BOUNDS[i] <= cx < BOUNDS[i + 1]:
                cells[i] = (cells[i] + " " + w["text"]).strip()
                confs[i] = w["conf"] if confs[i] is None else min(confs[i], w["conf"])
                break
    # CPT/ASA is always a single contiguous token (a 5-digit code, or two
    # joined by '/'); tesseract occasionally splits it into two low-confidence
    # fragments with a spurious gap (e.g. "0081" + "1/00811"). It never
    # legitimately contains whitespace, so collapse it back together.
    cells[3] = cells[3].replace(" ", "")
    return cells, confs


def recover_cpt_asa(img, row_top, zoom=ZOOM):
    """Targeted re-OCR fallback for rows where the whole-page pass found no
    CPT/ASA text at all (tesseract's layout analysis occasionally drops a
    whole cell rather than misreading it). Crops just that column at high
    zoom and retries -- this recovers text the full-page pass missed."""
    x0, x1 = BOUNDS[3] * zoom, BOUNDS[5] * zoom
    y0, y1 = (row_top - 3) * zoom, (row_top + 14) * zoom
    crop = img.crop((int(x0), int(y0), int(x1), int(y1)))
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
    text = pytesseract.image_to_string(crop, config="--psm 6").strip()
    m = re.match(r"^[\d\s./]+", text)
    if not m:
        return ""
    return re.sub(r"\s+", "", m.group(0)).strip("/")


def levenshtein(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[m][n]


def fix_modifier(text, conf=100.0):
    """Correct common OCR digit/letter confusions (e.g. 'SORT' -> '59RT',
    '5S9OLT' -> '59LT') against the closed vocabulary of CPT modifier codes
    used in this report, via minimum edit distance (ties broken toward the
    candidate closest in length to what was actually read).

    Only attempted when `conf` is low (<80). Confirmed against a real
    sample where this over-corrected: two genuinely-valid-but-not-yet-seen
    modifiers ("AAQS33", "AAET") were read at ~92 confidence -- the same
    range as unambiguously correct reads -- and got silently rewritten
    into a different, wrong known code purely because they were within
    edit distance 3 of one. Actual garbled reads in the same dataset
    ("SORT", "AGS9LT", "5S9OLT") all came in under 80 confidence, so
    gating on confidence reliably tells "needs fixing" apart from "just
    not in KNOWN_MODIFIERS yet" without requiring a complete vocabulary."""
    if not text:
        return text
    if text in KNOWN_MODIFIERS:
        return text
    if conf >= 80:
        return text

    best = min(KNOWN_MODIFIERS, key=lambda k: (levenshtein(text, k), abs(len(text) - len(k))))
    return best if levenshtein(text, best) <= 3 else text


TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def parse_hhmm(s):
    m = TIME_RE.match(s.strip()) if s else None
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def format_hhmm(minutes):
    minutes = int(round(minutes))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def reconcile_times(start_s, end_s, total_s):
    """If exactly one of start/end/total fails to parse as HH:MM, and the PDF
    genuinely shows all three for this row (i.e. at least one non-blank),
    derive it from the other two: End = Start + Total."""
    s, e, t = parse_hhmm(start_s), parse_hhmm(end_s), parse_hhmm(total_s)
    non_blank = sum(1 for x in (start_s, end_s, total_s) if x)
    if non_blank < 3:
        return start_s, end_s, total_s  # this row legitimately has no time data
    if s is not None and t is not None and e is None:
        end_s = format_hhmm(s + t)
    elif s is not None and e is not None and t is None:
        total_s = format_hhmm(e - s)
    elif e is not None and t is not None and s is None:
        start_s = format_hhmm(e - t)
    return start_s, end_s, total_s


def safe_float(s):
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


DECIMAL_COLON_RE = re.compile(r"^(\d+):(\d{2})$")


def fix_decimal_colon(text):
    """The Unit Value / Value / Age Value columns are plain decimals and
    should never contain a colon -- but tesseract occasionally misreads a
    decimal point as one (confirmed on a real sample: "7.25" -> "7:25" in
    the Value column, silently defaulting to 0.0 downstream since it no
    longer parses as a float, which also corrupted the otherwise-correct
    Total Distrib Units via reconcile_distrib_units's cross-check). Only
    applied as a fallback when the raw text doesn't already parse cleanly,
    so a genuine, already-valid number is never touched."""
    if not text or safe_float(text) is not None:
        return text
    m = DECIMAL_COLON_RE.match(text.strip())
    return f"{m.group(1)}.{m.group(2)}" if m else text


def reconcile_distrib_units(value, distrib_raw, distrib_conf, total_raw, total_conf):
    """Total Distrib Units == Value + Distributable Time Units always holds in
    this report (it's a running-total column). Use that invariant to correct
    whichever of the two OCR'd numbers has lower confidence when they disagree,
    or to recover one that failed to parse at all."""
    d = safe_float(distrib_raw)
    t = safe_float(total_raw)
    if d is None and t is None:
        return 0.0, 0.0
    if d is None:
        return round(t - value, 2), t
    if t is None:
        return d, round(value + d, 2)
    expected_t = round(value + d, 2)
    if abs(t - expected_t) > 0.02:
        dc = distrib_conf if distrib_conf is not None else 0
        tc = total_conf if total_conf is not None else 0
        if dc < tc:
            d = round(t - value, 2)
        else:
            t = round(value + d, 2)
    return d, t


def clean_name(text):
    text = re.sub(r"\s*-\s*", " - ", text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_criteria_line(text):
    """Parse the repeating top-of-page filter/criteria line into components."""
    result = {}
    m = re.search(r"Provider Organization\s*=\s*<\s*(.*?)\s*>", text)
    if m:
        result["provider_org"] = m.group(1)
    m = re.search(r"(?<!Organization )Provider\s*=\s*<\s*(.*?)\s*>", text)
    if m:
        result["provider"] = m.group(1)
    m = re.search(r"Date Type\s*=\s*<\s*(.*?)\s*>", text)
    if m:
        result["date_type"] = m.group(1)
    m = re.search(r"Date From\s*=\s*<\s*(.*?)\s*>", text)
    if m:
        result["date_from"] = m.group(1)
    m = re.search(r"Date To\s*=\s*<\s*(.*?)\s*>", text)
    if m:
        result["date_to"] = m.group(1)
    m = re.search(r"Exclude Net Zero Items\s*:\s*<\s*(.*?)\s*>", text)
    if m:
        result["exclude_net_zero"] = m.group(1)
    return result


def to_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


class DoctorGroup:
    def __init__(self, name):
        self.name = name
        self.rows = []  # list of dict with all 13 fields
        # Populated from this doctor's own "Total for <name>" subtotal row,
        # printed by the source system on the last page of their section --
        # not used to build line items (we recompute totals ourselves from
        # the parsed rows), but captured so the upload UI can cross-check
        # our OCR against the PDF's own printed numbers. None if that row
        # wasn't found/didn't parse cleanly.
        self.printed_totals = None


def parse_page_spec(spec, n_pages):
    """Parse a page selection like '6-10', '6,7,8', or '1-3,7,10-12' into a
    sorted, de-duplicated list of 0-indexed page indices."""
    pages = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
        else:
            start = end = int(part)
        if start < 1 or end > n_pages or start > end:
            raise ValueError(f"Page range '{part}' is out of bounds for a {n_pages}-page document")
        pages.update(range(start - 1, end))
    return sorted(pages)


def extract(pdf_path, first_page=None, last_page=None, pages=None):
    doc = fitz.open(pdf_path)
    n_pages = len(doc)

    if pages:
        page_indices = parse_page_spec(pages, n_pages)
    else:
        first = (first_page - 1) if first_page else 0
        last = (last_page - 1) if last_page else n_pages - 1
        page_indices = list(range(first, last + 1))

    doctors = []
    current = None
    criteria_text = None

    for pi in page_indices:
        img = render_page(doc, pi)
        words = ocr_words(img)

        header_words = [w for w in words if 30 < w["top"] < HEADER_CUTOFF_PT]
        if criteria_text is None:
            # Cluster into lines first (small punctuation glyphs like <, =, >
            # have jittery top-coordinates that break a flat top-sort).
            header_lines = group_rows(header_words, tol=4.0)
            criteria_text = " ".join(
                w["text"] for line in header_lines for w in line["words"])

        body_words = [w for w in words if w["top"] >= HEADER_CUTOFF_PT]
        rows = group_rows(body_words)
        rows = recover_missed_rows(img, rows, ZOOM)

        for row in rows:
            cells, confs = bin_row_to_columns(row["words"])
            descriptor = " ".join(c for c in cells[:5] if c).strip()
            descriptor_norm = re.sub(r"\s+", " ", descriptor)

            if re.search(r"Doctor\s*Name", descriptor_norm, re.IGNORECASE):
                name = re.sub(r"Doctor\s*Name\s*:?", "", descriptor_norm, flags=re.IGNORECASE)
                name = clean_name(name)
                current = DoctorGroup(name)
                doctors.append(current)
                continue

            if re.match(r"^Total\s*for\b", descriptor_norm, re.IGNORECASE):
                # Subtotal row -- not used to build line items (we recompute
                # totals ourselves from the parsed data rows), but captured
                # for the upload UI's cross-check against the PDF's own
                # printed numbers.
                if current is not None:
                    d_units = safe_float(fix_decimal_colon(cells[11]))
                    t_units = safe_float(fix_decimal_colon(cells[12]))
                    if d_units is not None and t_units is not None:
                        current.printed_totals = {
                            "distributableUnits": d_units,
                            "totalDistribUnits": t_units,
                        }
                continue

            if re.match(r"^\d{4,7}$", cells[0]):
                if current is None:
                    current = DoctorGroup("")
                    doctors.append(current)
                if not cells[3]:
                    cells[3] = recover_cpt_asa(img, row["top"])
                cells[4] = fix_modifier(cells[4], confs[4] if confs[4] is not None else 100.0)
                cells[5] = fix_decimal_colon(cells[5])
                cells[6] = fix_decimal_colon(cells[6])
                cells[7] = fix_decimal_colon(cells[7])
                start_time, end_time, total_time = reconcile_times(cells[8], cells[9], cells[10])
                value = safe_float(cells[6]) or 0.0
                distrib_units, total_distrib_units = reconcile_distrib_units(
                    value, cells[11], confs[11], cells[12], confs[12])
                current.rows.append({
                    "incident_id": cells[0],
                    "service_dt": cells[1],
                    "ticket_num": cells[2],
                    "cpt_asa": cells[3],
                    "modifier": cells[4],
                    "unit_value_raw": cells[5],
                    "value_raw": cells[6],
                    "age_value_raw": cells[7],
                    "start_time": start_time,
                    "end_time": end_time,
                    "total_time": total_time,
                    "distributable_units": distrib_units,
                    "total_distrib_units": total_distrib_units,
                })
                continue
            # otherwise: footer/copyright/noise line -> ignore

    criteria = parse_criteria_line(criteria_text or "")
    return doctors, criteria


# ─── LineItem JSON conversion (for the BPT server integration) ────────────────

def service_date_to_iso(mmddyyyy):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", (mmddyyyy or "").strip())
    if not m:
        return mmddyyyy or ""
    mm, dd, yyyy = m.groups()
    return f"{yyyy}-{int(mm):02d}-{int(dd):02d}"


def to_line_items(doctors):
    """Flatten every doctor group's rows into the exact JSON shape BPT's
    `LineItem` type expects (webapp/src/types.ts), matching the field
    conventions of webapp/src/utils/xlsxParser.ts's parseRawRows."""
    items = []
    for doc_group in doctors:
        for row in doc_group.rows:
            items.append({
                "incidentId": row["incident_id"],
                "serviceDate": service_date_to_iso(row["service_dt"]),
                "ticketNum": row["ticket_num"],
                "cptAsa": row["cpt_asa"],
                "modifier": row["modifier"] or "",
                "unitValue": to_float(row["unit_value_raw"]) if row["unit_value_raw"] else None,
                "distributionValue": to_float(row["value_raw"]),
                "startTime": row["start_time"] or None,
                "endTime": row["end_time"] or None,
                "totalTime": row["total_time"] or None,
                "timeUnits": row["distributable_units"],
                "totalDistributableUnits": row["total_distrib_units"],
            })
    return items


def primary_doctor_name(doctors):
    for d in doctors:
        if d.name and d.rows:
            return d.name
    return ""


def aggregate_printed_totals(doctors):
    """Sum each doctor group's own printed subtotal row across the whole
    extracted range, for the upload UI to cross-check against its own
    computed sums. None if any group with rows is missing one -- a partial
    aggregate would be misleading rather than merely incomplete."""
    groups_with_rows = [d for d in doctors if d.rows]
    if not groups_with_rows or any(d.printed_totals is None for d in groups_with_rows):
        return None
    return {
        "distributableUnits": round(sum(d.printed_totals["distributableUnits"] for d in groups_with_rows), 2),
        "totalDistribUnits": round(sum(d.printed_totals["totalDistribUnits"] for d in groups_with_rows), 2),
    }


# ─── Section detection (find report pages within a bundled PDF) ──────────────

def detect_sections(pdf_path):
    doc = fitz.open(pdf_path)
    n_pages = len(doc)

    is_report_page = [False] * n_pages
    doctor_on_page = [None] * n_pages

    for pi in range(n_pages):
        img = render_page(doc, pi, zoom=DETECT_ZOOM, clip_pt=DETECT_BAND_PT)
        words = ocr_words(img, zoom=DETECT_ZOOM)
        text = " ".join(w["text"] for w in words).lower()
        if "distribution report" not in text:
            continue
        is_report_page[pi] = True

        lines = group_rows([w for w in words if 30 < w["top"]], tol=4.0)
        for line in lines:
            line_text = " ".join(w["text"] for w in line["words"])
            if re.search(r"Doctor\s*Name", line_text, re.IGNORECASE):
                name = re.sub(r"Doctor\s*Name\s*:?", "", line_text, flags=re.IGNORECASE)
                doctor_on_page[pi] = clean_name(name)
                break

    sections = []
    current = None
    for pi in range(n_pages):
        page_no = pi + 1
        if not is_report_page[pi]:
            if current:
                sections.append(current)
                current = None
            continue
        name = doctor_on_page[pi]
        if current is None:
            current = {"startPage": page_no, "endPage": page_no, "doctorName": name or ""}
        elif name and name != current["doctorName"]:
            sections.append(current)
            current = {"startPage": page_no, "endPage": page_no, "doctorName": name}
        else:
            current["endPage"] = page_no
    if current:
        sections.append(current)

    return n_pages, sections


# ─── Bonus pages: 12-Month Summary ($/unit) + Corrections (unit adjustment) ───

def physician_tokens(name):
    """Pull a doctor-number and surname out of a "187 - OSMANI, BIJAN" /
    "187 OSMANI" / "187-OSMANI" style label, for a light identity check
    against the bonus pages' own (differently-formatted) physician label."""
    digits = re.search(r"\d+", name)
    letters = re.findall(r"[A-Za-z]+", name)
    surname = letters[0] if letters else None
    return (digits.group(0) if digits else None), (surname.lower() if surname else None)


def physician_matches(band_text_lower, cdr_doctor_name):
    num, surname = physician_tokens(cdr_doctor_name)
    if not surname:
        return True  # nothing to check against -- don't block on it
    if surname not in band_text_lower:
        return False
    return (num in band_text_lower) if num else True


def find_bonus_pages(doc, cdr_doctor_name):
    """Cheap top-band scan (same technique as detect_sections) for a
    "Physician 12 Month Summary" page and any "<MON> ... Corrections" pages
    bundled elsewhere in the same PDF. Returns (summary_page_index or None,
    [{"page": i, "month": mm, "year": yyyy}, ...] for corrections pages).
    Only pages whose header plausibly names the same physician as the
    Case Distribution Report are considered."""
    n_pages = len(doc)
    summary_page = None
    correction_pages = []

    for pi in range(n_pages):
        img = render_page(doc, pi, zoom=DETECT_ZOOM, clip_pt=DETECT_BAND_PT)
        words = ocr_words(img, zoom=DETECT_ZOOM)
        text = " ".join(w["text"] for w in words)
        text_lower = text.lower()

        if summary_page is None and MONTH_SUMMARY_TITLE_RE.search(text_lower):
            if physician_matches(text_lower, cdr_doctor_name):
                summary_page = pi
            continue

        if CORRECTIONS_TITLE_RE.search(text_lower):
            m = ACCT_DATE_RE.search(text)
            if not m:
                # The Acct Date text is small enough that DETECT_ZOOM
                # sometimes can't read it -- retry this one page at full
                # zoom before giving up on it.
                hi_img = render_page(doc, pi, clip_pt=DETECT_BAND_PT)
                hi_words = ocr_words(hi_img)
                hi_text = " ".join(w["text"] for w in hi_words)
                m = ACCT_DATE_RE.search(hi_text)
                if not m:
                    continue  # can't tell which month this correction is for
            if not physician_matches(text_lower, cdr_doctor_name):
                continue
            correction_pages.append({
                "page": pi,
                "month": int(m.group(1)),
                "year": int(m.group(2)),
            })

    return summary_page, correction_pages


def extract_summary_row(doc, page_index, target_month, target_year):
    """OCR the 12-Month Summary page and return the row matching
    target_month/target_year, or None if that month isn't in its
    (rolling 12-month) table."""
    img = render_page(doc, page_index)
    words = ocr_words(img)
    rows = group_rows(words)
    target_abbr = MONTH_ABBR3[target_month - 1]
    target_yy = target_year % 100

    for row in rows:
        text_norm = re.sub(r"\s+", " ", " ".join(w["text"] for w in row["words"])).strip()
        m = SUMMARY_ROW_RE.match(text_norm)
        if not m:
            continue
        abbr, yy, units_s, rate_s, dist_s = m.groups()
        if abbr.lower() != target_abbr or int(yy) != target_yy:
            continue
        return {
            "unitsDistributed": to_float(units_s.replace(",", "")),
            "ratePerUnit": to_float(rate_s.replace(",", "")),
            "dollarsDistributed": to_float(dist_s.replace(",", "")),
        }
    return None


def read_correction_value(doc, page_index):
    """Read the 'PCR CORRECTION' row's value cell via the fixed anchor
    calibrated in CORRECTION_VALUE_RECT_PT. The cell is boxed in a red
    border that badly confuses tesseract's default binarization (misreads
    e.g. "0.5" as "08"); red pixels are scrubbed to white first, which
    fixed that reliably in testing against real samples. Returns a float,
    or None if the page isn't the expected size/layout or nothing
    number-shaped was read."""
    page = doc[page_index]
    if (round(page.rect.width), round(page.rect.height)) != (
        round(BONUS_PAGE_PT_SIZE[0]), round(BONUS_PAGE_PT_SIZE[1])
    ):
        return None

    zoom = 12
    mat = fitz.Matrix(zoom, zoom)
    clip = fitz.Rect(*CORRECTION_VALUE_RECT_PT)
    pix = page.get_pixmap(matrix=mat, clip=clip)
    mode = "RGB" if pix.n < 4 else "RGBA"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("RGB")

    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = px[x, y][:3]
            if r - g > 40 and r - b > 40:  # scrub the red border to white
                px[x, y] = (255, 255, 255)

    gray = img.convert("L")
    bw = gray.point(lambda v: 0 if v < 180 else 255, mode="L")
    text = pytesseract.image_to_string(
        bw, config="--psm 7 -c tessedit_char_whitelist=0123456789.-"
    ).strip()

    if not re.match(r"^-?\d+(\.\d+)?$", text):
        return None
    return float(text)


def extract_unit_info(doc, doctors, cdr_doctor_name, target_month, target_year):
    """Best-effort: cross-reference the bundled 12-Month Summary / Corrections
    pages (if present) against the just-parsed line items to auto-fill $/unit
    and the unit correction, with a reconciliation check. Returns None if no
    summary page was found (the common case -- a bare line-items-only PDF),
    so callers can fall back to today's fully-manual entry unchanged."""
    summary_page, correction_pages = find_bonus_pages(doc, cdr_doctor_name)
    if summary_page is None:
        return None

    summary_row = extract_summary_row(doc, summary_page, target_month, target_year)
    if summary_row is None:
        return None

    correction = 0.0
    for c in correction_pages:
        if c["month"] == target_month and c["year"] == target_year:
            value = read_correction_value(doc, c["page"])
            if value is not None:
                correction = value
            break

    ocr_units = sum(r["total_distrib_units"] for d in doctors for r in d.rows)
    denom = ocr_units + correction
    computed_rate = round(summary_row["dollarsDistributed"] / denom, 4) if denom else None
    reconciled = (
        computed_rate is not None
        and abs(computed_rate - summary_row["ratePerUnit"]) <= 0.01
    )

    return {
        "unitDollarValue": summary_row["ratePerUnit"],
        "unitCorrection": correction,
        "reconciled": reconciled,
    }


# ─── Bonus pages: Income Statement ("PCR - <doctor>", revenues + expenses) ────
# Genuinely different from the other bonus pages above: column count (and
# even page width) varies with how many months the statement covers -- 2
# columns on a standard-width page for January, up to 13 columns on a
# ~1026pt-wide page for December -- so column positions are derived from
# each page's own header row every time, never a fixed anchor list.

INCOME_STATEMENT_TITLE_RE = re.compile(r"pcr\s*-\s*\d", re.IGNORECASE)
MONTH_HEADER_RE = re.compile(
    r"^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$", re.IGNORECASE
)
YEAR_RE = re.compile(r"^\d{4}$")

# The only three top-level dividers this feature needs to recognize by
# name. A section opens on the bare header and closes on its own exact
# "Total X" counterpart -- deliberately *not* indentation-based: measured
# indentation is too fragile in practice (confirmed on a real sample
# where a single badly-OCR'd row's bounding box landed ~11pt shallower
# than it should have, which would have force-closed the wrong section).
# Matching is done with whitespace stripped, since OCR occasionally
# merges "Total X" into one word (seen elsewhere in this file too).
SECTION_OPENER_KEYS = {
    "stipends": "stipend",
    "expenses": "expense",
    "otherprofessionalincome": "otherIncome",
}
SECTION_CLOSER_KEYS = {
    "totalstipends": True,
    "totalexpenses": True,
    "totalotherprofessionalincome": True,
}


def find_income_statement_pages(doc, cdr_doctor_name):
    """Cheap top-band scan for the "PCR - <doctor>" income-statement pages
    bundled elsewhere in the PDF. These span 2-3 *consecutive* pages (a
    revenues page, then an expenses/summary continuation) -- returns that
    contiguous run of page indices, or [] if none found."""
    n_pages = len(doc)
    pages = []
    for pi in range(n_pages):
        img = render_page(doc, pi, zoom=DETECT_ZOOM, clip_pt=DETECT_BAND_PT)
        words = ocr_words(img, zoom=DETECT_ZOOM)
        text_lower = " ".join(w["text"] for w in words).lower()
        if INCOME_STATEMENT_TITLE_RE.search(text_lower) and physician_matches(text_lower, cdr_doctor_name):
            pages.append(pi)
    if not pages:
        return []
    run = [pages[0]]
    for pi in pages[1:]:
        if pi == run[-1] + 1:
            run.append(pi)
        else:
            break
    return run


def parse_money(text):
    """Parse a dollar figure that may have a '$' prefix, thousands commas,
    and accounting-parens negatives (confirmed: OCR reads "(20,199.14)" as
    one clean token). Also repairs the decimal-point-misread-as-colon bug
    already fixed for the line-items table, since it's the same OCR engine
    against the same kind of numeric text."""
    if not text:
        return None
    t = text.strip().lstrip("$").strip()
    if not t:
        return None
    neg = t.startswith("(") and t.endswith(")")
    if neg:
        t = t[1:-1]
    t = t.replace(",", "")
    t = fix_decimal_colon(t)
    v = safe_float(t)
    if v is None:
        return None
    return -v if neg else v


def extract_income_statement(doc, page_indices):
    """Parse the multi-page cash-basis income statement. Returns a list of
    {"year", "month", "lines": [{"label", "section", "amount"}, ...]}, one
    entry per real month column found -- the trailing TOTAL column is a
    rollup, not a distinct month, and is discarded. STIPENDS/EXPENSES/
    OTHER PROFESSIONAL INCOME open a section; their own "Total X" labels
    close it again (see SECTION_OPENER_KEYS/SECTION_CLOSER_KEYS)."""
    columns = None  # [{"month","year","anchor"}, ...] real months only, carried across pages
    total_anchor = None
    column_lines = None  # parallel to columns
    current_section = "other"

    for pi in page_indices:
        img = render_page(doc, pi)
        words = ocr_words(img)
        rows = group_rows(words, tol=5.0)
        if not rows:
            continue

        header_row = None
        for r in rows:
            texts_upper = [w["text"].upper() for w in r["words"]]
            if "TOTAL" in texts_upper and any(MONTH_HEADER_RE.match(t) for t in texts_upper):
                header_row = r
                break

        if header_row is not None:
            # Confirmed on a real sample: tesseract's whole-page OCR can
            # drop an entire row here too (an "EXPENSES" section header,
            # in that case) -- unlike the Case Distribution Report table,
            # this page's own header row sits a normal row-height above
            # the first body row (~13.7pt), not a tight fixed cutoff.
            rows = recover_missed_rows(img, rows, ZOOM,
                                        start_boundary=header_row["top"],
                                        header_gap_pt=13.7, row_gap_pt=13.7)

        if columns is None:
            if header_row is None:
                continue  # can't establish columns from this page; try the next
            columns, total_anchor = [], None
            hw = header_row["words"]
            i = 0
            while i < len(hw):
                text = hw[i]["text"].upper()
                if text == "TOTAL":
                    total_anchor = hw[i]["left"] + hw[i]["width"] / 2
                    i += 1
                elif MONTH_HEADER_RE.match(text) and i + 1 < len(hw) and YEAR_RE.match(hw[i + 1]["text"]):
                    month = MONTH_ABBR3.index(text.lower()) + 1
                    year = int(hw[i + 1]["text"])
                    anchor = (hw[i]["left"] + hw[i + 1]["left"] + hw[i + 1]["width"]) / 2
                    columns.append({"month": month, "year": year, "anchor": anchor})
                    i += 2
                else:
                    i += 1
            if not columns:
                columns = None
                continue
            column_lines = [[] for _ in columns]

        anchors = [c["anchor"] for c in columns]
        last_anchor = total_anchor if total_anchor is not None else anchors[-1] + (anchors[-1] - anchors[-2] if len(anchors) > 1 else 100.0)
        all_anchors = anchors + [last_anchor]
        label_boundary = anchors[0] - (all_anchors[1] - anchors[0]) / 2
        bounds = [label_boundary] + [(a + b) / 2 for a, b in zip(all_anchors, all_anchors[1:])] + [last_anchor + 1000.0]

        header_top = header_row["top"] if header_row else -1
        for row in rows:
            if row is header_row or row["top"] <= header_top:
                continue
            label_parts, cells = [], [[] for _ in columns]
            for w in row["words"]:
                cx = w["left"] + w["width"] / 2
                if cx < bounds[0]:
                    label_parts.append(w)
                    continue
                for ci in range(len(columns)):
                    if bounds[ci] <= cx < bounds[ci + 1]:
                        cells[ci].append(w["text"])
                        break
                    if ci == len(columns) - 1 and bounds[ci + 1] <= cx < bounds[ci + 2]:
                        pass  # falls in the discarded TOTAL column
            if not label_parts:
                continue
            label_parts.sort(key=lambda w: w["left"])
            label = " ".join(w["text"] for w in label_parts).strip()
            label = re.sub(r'^["\']+', "", label)  # occasional stray leading quote glyph
            if not label:
                continue

            # Normalize away spacing (OCR occasionally merges "Total X"
            # into one word, as already seen elsewhere in this file) for
            # matching against the known section open/close labels only;
            # the original `label` (with spacing) is still what gets
            # stored.
            label_key = re.sub(r"\s+", "", label).lower()
            if label_key in SECTION_OPENER_KEYS:
                current_section = SECTION_OPENER_KEYS[label_key]
                continue
            if label_key in SECTION_CLOSER_KEYS:
                current_section = "other"
                continue
            label_lower = label.lower()
            if label_lower.startswith("total "):
                continue

            for ci, cell_words in enumerate(cells):
                amount = parse_money(" ".join(cell_words)) if cell_words else None
                column_lines[ci].append({
                    "label": label,
                    "section": current_section,
                    "amount": amount if amount is not None else 0.0,
                })

    if not columns:
        return []
    return [
        {"year": c["year"], "month": c["month"], "lines": lines}
        for c, lines in zip(columns, column_lines)
    ]


# ─── xlsx writer (standalone CLI use only) ────────────────────────────────────

THIN = Side(style="thin")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
BOLD = Font(bold=True)
TITLE_FONT = Font(bold=True, size=14)


def write_xlsx(doctors, criteria, out_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Case Distribution Report"

    n_cols = len(COLUMNS)

    r = 1

    def merged(row, text, font=None, align=None):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=n_cols)
        cell = ws.cell(row=row, column=1, value=text)
        if font:
            cell.font = font
        cell.alignment = align or Alignment(horizontal="center")
        return row + 1

    r = merged(r, "CENTRAL ANESTHESIA SERVICE EXCHANGE", TITLE_FONT)
    r = merged(r, "Case Distribution Report", Font(bold=True, size=12))

    org = criteria.get("provider_org", "")
    prov = criteria.get("provider")
    date_type = criteria.get("date_type", "")
    date_from = criteria.get("date_from", "")
    date_to = criteria.get("date_to", "")
    exclude = criteria.get("exclude_net_zero", "")
    crit_line = f"Provider Organization = < {org} >"
    if prov:
        crit_line += f", Provider = < {prov} >"
    crit_line += (f" Date Type = < {date_type} >, Date From=<{date_from}>, "
                  f"Date To= < {date_to}> Exclude Net Zero Items : <{exclude}>")
    r = merged(r, crit_line, Font(italic=True, size=9), Alignment(horizontal="left"))
    r += 1  # blank row

    header_row = r
    for i, name in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=header_row, column=i, value=name)
        cell.font = BOLD
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
        cell.border = BOX
    r += 1
    r += 1  # blank row

    grand = {"unit_value": 0.0, "value": 0.0, "age_value": 0.0,
             "distributable_units": 0.0, "total_distrib_units": 0.0}
    summary_rows = []

    for doc_group in doctors:
        if not doc_group.rows:
            continue
        r = merged(r, f"Doctor Name : {doc_group.name}", BOLD, Alignment(horizontal="left"))

        totals = {"unit_value": 0.0, "value": 0.0, "age_value": 0.0,
                  "distributable_units": 0.0, "total_distrib_units": 0.0}

        for row in doc_group.rows:
            values = [
                row["incident_id"], row["service_dt"], row["ticket_num"],
                row["cpt_asa"], row["modifier"],
                to_float(row["unit_value_raw"]) if row["unit_value_raw"] else None,
                to_float(row["value_raw"]) if row["value_raw"] else None,
                to_float(row["age_value_raw"]) if row["age_value_raw"] else None,
                row["start_time"], row["end_time"], row["total_time"],
                row["distributable_units"], row["total_distrib_units"],
            ]
            for i, v in enumerate(values, start=1):
                ws.cell(row=r, column=i, value=v)
            r += 1
            totals["unit_value"] += to_float(row["unit_value_raw"])
            totals["value"] += to_float(row["value_raw"])
            totals["age_value"] += to_float(row["age_value_raw"])
            totals["distributable_units"] += row["distributable_units"]
            totals["total_distrib_units"] += row["total_distrib_units"]

        # Subtotal row for this doctor
        ws.cell(row=r, column=4, value=f"Total for {doc_group.name}").font = BOLD
        for col, key in [(6, "unit_value"), (7, "value"), (8, "age_value"),
                          (12, "distributable_units"), (13, "total_distrib_units")]:
            c = ws.cell(row=r, column=col, value=round(totals[key], 2))
            c.font = BOLD
        r += 1
        r += 1  # blank row

        summary_rows.append((doc_group.name, totals))
        for k in grand:
            grand[k] += totals[k]

    # Summary section
    r = merged(r, "Summary", BOLD)
    for i, name in enumerate(["Doctor name", "Unit Value", "Value", "Age Value",
                               "Distributable Time Units", "Total Distributable Units"], start=1):
        c = ws.cell(row=r, column=i, value=name)
        c.font = BOLD
        c.border = BOX
    r += 1
    for name, totals in summary_rows:
        ws.cell(row=r, column=1, value=name)
        ws.cell(row=r, column=2, value=round(totals["unit_value"], 2))
        ws.cell(row=r, column=3, value=round(totals["value"], 2))
        ws.cell(row=r, column=4, value=round(totals["age_value"], 2))
        ws.cell(row=r, column=5, value=round(totals["distributable_units"], 2))
        ws.cell(row=r, column=6, value=round(totals["total_distrib_units"], 2))
        r += 1
    ws.cell(row=r, column=1, value="Grand Total:").font = BOLD
    ws.cell(row=r, column=2, value=round(grand["unit_value"], 2)).font = BOLD
    ws.cell(row=r, column=3, value=round(grand["value"], 2)).font = BOLD
    ws.cell(row=r, column=4, value=round(grand["age_value"], 2)).font = BOLD
    ws.cell(row=r, column=5, value=round(grand["distributable_units"], 2)).font = BOLD
    ws.cell(row=r, column=6, value=round(grand["total_distrib_units"], 2)).font = BOLD
    r += 2

    r = merged(r, "Search Criteria - Expanded", BOLD, Alignment(horizontal="left"))
    r = merged(r, f"{date_type or 'Posted Date'} from {date_from} to {date_to}",
               None, Alignment(horizontal="left"))
    r = merged(r, f"Provider Organization : {org}", None, Alignment(horizontal="left"))
    if prov:
        r = merged(r, f"Provider : {prov}", None, Alignment(horizontal="left"))
    r = merged(r, f"Exclude Net Zero Items : <{exclude}>", None, Alignment(horizontal="left"))
    r += 1

    r = merged(r, "© PHIMED Technologies 2006 - 2026 CPT Copyright 2025 AMA. All rights Reserved.",
               Font(size=8), Alignment(horizontal="left"))

    widths = [12, 12, 11, 13, 10, 10, 9, 9, 9, 9, 9, 13, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    wb.save(out_path)


# ─── CLI ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    p_detect = sub.add_parser("detect", help="Scan a PDF for report page ranges")
    p_detect.add_argument("pdf")

    p_extract = sub.add_parser("extract", help="Extract line items from a page range")
    p_extract.add_argument("pdf")
    p_extract.add_argument("--pages", required=True,
                            help="e.g. '6-10' or '1,3,5-8' (1-indexed)")
    p_extract.add_argument("--json", action="store_true",
                            help="Print LineItem-shaped JSON to stdout")

    p_xlsx = sub.add_parser("xlsx", help="Write an .xlsx replica (standalone CLI use)")
    p_xlsx.add_argument("pdf")
    p_xlsx.add_argument("-o", "--output", required=True)
    p_xlsx.add_argument("--pages", default=None)
    p_xlsx.add_argument("--first-page", type=int, default=None)
    p_xlsx.add_argument("--last-page", type=int, default=None)

    args = ap.parse_args()

    try:
        if args.command == "detect":
            page_count, sections = detect_sections(args.pdf)
            json.dump({"pageCount": page_count, "sections": sections}, sys.stdout)
            return

        if args.command == "extract":
            doctors, criteria = extract(args.pdf, pages=args.pages)
            line_items = to_line_items(doctors)
            if args.json:
                doctor_name = primary_doctor_name(doctors)
                unit_info = None
                income_statement = []
                date_match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", criteria.get("date_from") or "")
                if date_match and doctor_name:
                    target_month, target_year = int(date_match.group(1)), int(date_match.group(3))
                    bonus_doc = fitz.open(args.pdf)
                    unit_info = extract_unit_info(bonus_doc, doctors, doctor_name, target_month, target_year)
                    stmt_pages = find_income_statement_pages(bonus_doc, doctor_name)
                    if stmt_pages:
                        income_statement = extract_income_statement(bonus_doc, stmt_pages)
                json.dump({
                    "doctorName": doctor_name,
                    "criteria": criteria,
                    "lineItems": line_items,
                    "unitInfo": unit_info,
                    "printedTotals": aggregate_printed_totals(doctors),
                    "incomeStatement": income_statement,
                }, sys.stdout)
            else:
                print(f"{len(line_items)} line item(s) from {len(doctors)} doctor group(s)")
            return
    except Exception as e:
        # Surface a clean one-line message on stderr (not a full traceback) --
        # the Node caller (webapp/server/pdfParser.ts) reports stderr verbatim.
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    if args.command == "xlsx":
        doctors, criteria = extract(args.pdf, args.first_page, args.last_page, args.pages)
        write_xlsx(doctors, criteria, args.output)
        total_rows = sum(len(d.rows) for d in doctors)
        print(f"Wrote {args.output}: {len(doctors)} doctor group(s), {total_rows} data row(s)")
        return


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Parse a monthly CASE physician schedule PDF (a wide grid: physicians as
rows, days of the month as columns, one shift code per cell) into structured
per-physician day-by-day data.

Relies on the PDF's embedded text layer (PyMuPDF's page.get_text("words")).
If a page has no usable text layer (e.g. a scanned copy), it's skipped; if no
page in the document yields a valid grid, this raises a clear error asking
for a text-based export instead.

Usage:
    python3 parse_schedule_pdf.py INPUT.pdf --json
"""
import argparse
import json
import re
import statistics
import sys

import pymupdf as fitz

DAY_RE = re.compile(r"^\d{1,2}$")
DOW_TOKENS = {"M", "T", "W", "TH", "F", "SA", "SU"}
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


def words_from_text(page):
    return [(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text("words")]


def group_rows(words, tol):
    """Cluster words into rows by y (top), tolerant of sub-pixel jitter."""
    ws = sorted(words, key=lambda w: (w[1], w[0]))
    rows = []
    for w in ws:
        for r in rows:
            if abs(r["top"] - w[1]) <= tol:
                r["words"].append(w)
                r["top"] = (r["top"] * r["n"] + w[1]) / (r["n"] + 1)
                r["n"] += 1
                break
        else:
            rows.append({"top": w[1], "n": 1, "words": [w]})
    rows.sort(key=lambda r: r["top"])
    for r in rows:
        r["words"].sort(key=lambda w: w[0])
    return rows


def find_day_header_band(words, page_height):
    """Locate the row of sequential day-of-month numbers (1..N) near the top
    of the page. Returns the band (words sorted by x) or None."""
    candidates = [w for w in words if DAY_RE.match(w[4]) and w[1] < page_height * 0.25]
    if len(candidates) < 20:
        return None
    tops = [w[1] for w in candidates]
    # Cluster tops with a tight tolerance to find the single dominant header row
    best_top, best_count = None, 0
    for t in tops:
        count = sum(1 for x in tops if abs(x - t) <= 2.5)
        if count > best_count:
            best_count, best_top = count, t
    band = sorted([w for w in candidates if abs(w[1] - best_top) <= 2.5], key=lambda w: w[0])
    if not (28 <= len(band) <= 31):
        return None
    values = [int(w[4]) for w in band]
    if values != sorted(values):
        return None
    return band


def find_dow_row_bottom(words, day_band):
    day_bottom = max(w[3] for w in day_band)
    band = [w for w in words if day_bottom < w[1] < day_bottom + 15 and w[4].upper() in DOW_TOKENS]
    if len(band) >= 15:
        return max(w[3] for w in band)
    return day_bottom + 8


def find_month_year(words, header_top):
    top_words = sorted([w for w in words if w[1] < header_top - 5], key=lambda w: (w[1], w[0]))
    text = " ".join(w[4] for w in top_words).lower()
    month = next((i + 1 for i, name in enumerate(MONTH_NAMES) if name in text), None)
    m = re.search(r"\b(20\d{2})\b", text)
    year = int(m.group(1)) if m else None
    return month, year


def parse_page(words, page_height):
    day_band = find_day_header_band(words, page_height)
    if day_band is None:
        return None

    anchors = [(w[0] + w[2]) / 2 for w in day_band]
    col_width = statistics.median([b - a for a, b in zip(anchors, anchors[1:])])
    label_right = anchors[0] - col_width / 2
    right_end = anchors[-1] + col_width / 2
    bounds = [label_right] + [(a + b) / 2 for a, b in zip(anchors, anchors[1:])] + [right_end]

    header_top = min(w[1] for w in day_band)
    header_cutoff = find_dow_row_bottom(words, day_band) + 0.5
    month, year = find_month_year(words, header_top)

    body_words = [w for w in words if w[1] >= header_cutoff and label_right - 60 < w[0] < right_end]
    rows = group_rows(body_words, tol=3.5)  # measured row spacing is ~7.3pt in the reference sample

    result_rows = []
    for row in rows:
        label_words = [w for w in row["words"] if w[0] < label_right]
        if not label_words:
            continue
        label = " ".join(w[4] for w in label_words).strip()
        if not any(c.islower() for c in label):
            continue  # header remnants / stray marks are never lowercase

        cells = ["" for _ in anchors]
        for w in row["words"]:
            if w[0] < label_right:
                continue
            cx = (w[0] + w[2]) / 2
            for i in range(len(anchors)):
                if bounds[i] <= cx < bounds[i + 1]:
                    cells[i] += w[4]  # concatenate without space -- a cell is always one contiguous code
                    break
        result_rows.append({"name": label, "shifts": cells})

    if not result_rows:
        return None

    return {"month": month, "year": year, "rows": result_rows}


def parse(pdf_path):
    doc = fitz.open(pdf_path)
    for i in range(len(doc)):
        page = doc[i]
        result = parse_page(words_from_text(page), page.rect.height)
        if result is not None:
            result["sourcePage"] = i + 1
            return result
    raise ValueError(
        "No schedule grid found in this PDF's text layer. This parser needs a "
        "text-based export (not a scanned image) -- try re-exporting or "
        "printing the schedule to PDF directly."
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--json", action="store_true", help="Print JSON to stdout")
    args = ap.parse_args()

    try:
        result = parse(args.pdf)
        if args.json:
            json.dump(result, sys.stdout)
        else:
            print(f"page {result['sourcePage']}: {result['month']}/{result['year']}, "
                  f"{len(result['rows'])} row(s)")
    except Exception as e:
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

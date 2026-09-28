# Changelog

## v3.9.1 — 2026-09-28

- Fixed schedule PDF import failing on some months. A grid that includes one
  extra lookahead column for the 1st of the next month was being rejected
  outright ("No schedule grid found") even though the file was completely
  readable.

## v3.9.0 — 2026-09-27

- **Annual Summary — Days Worked.** "Days w/ Production" is renamed "Days
  Worked" and now calls out Board Runner (BR) shifts that had no case
  production of their own, shown separately (e.g. "144 + 6") instead of
  silently lumped in with real production days.
- **Annual Summary — Dollar per Unit Trend.** Added a dashed line showing the
  average rate across the displayed months, positioned so its label stays
  readable no matter where the trend line crosses it.
- **Annual Summary — Hours Worked.** Fixed the weekly/monthly average hours
  being pulled down by weeks or months that were entirely vacation, holiday,
  or post-call (zero real hours). Those periods no longer count against the
  average — in one real case the weekly average was understated by over 12%.

## v3.8.0 — 2026-09-26

- The per-day "Additional Stipend" field is renamed "Stipend Adjustment" and
  now accepts negative amounts, for correcting pay when a shift was split
  with someone else.
- The Stipend Calculator's day-by-day breakdown now shows each day's rate,
  an editable adjustment, and the net total.
- PCR Stipend Audit mismatches on the Audits page are now clickable and jump
  straight to the relevant days in the Stipend Calculator.

## v3.7.0 — 2026-09-26

- Unit pay now uses the precise $/unit rate implied by the PCR's own income
  statement, instead of the two-decimal rate printed on the report — fixes
  small rounding differences (a few dollars) in monthly unit pay.
- Refreshed the Help & Guide page to match current features.

## v3.6.0 — 2026-09-26

- PDF-uploaded PCR reports now flag line items the OCR wasn't confident
  about or had to auto-correct, with a picture of the original PDF row to
  compare against, and any line item can be corrected by hand.
- Fixed a decimal-misread bug that could badly overstate a case's billed
  units.
- PCR Income Statement lines can now be corrected, relabeled, or added and
  removed by hand — corrections are kept even if the same month's report is
  uploaded again later.
- Fixed income-statement expenses landing in the wrong category and the
  wrong months for reports using a different page layout.

## v3.5.0 — 2026-09-21

- Fixed a bug where an automatically-applied stipend carve-out (Fort
  Sutter/ROC/Alhambra) could silently overwrite a stipend amount already
  entered by hand for the same day.

## v3.4.0 — 2026-09-16

- Fixed importing an older backup leaving the PCR Category Mapping list
  empty instead of restoring the defaults.
- The version number shown in Settings now always matches the app's actual
  version, instead of a hardcoded number that could go stale.

## v3.3.0 — 2026-09-16

- Compensation's pie chart: renamed "Net Income" to "Cash Compensation" and
  it can now be drilled into further (down to individual categories like
  Benicomp, CME, and Phone/Internet).
- Cash reimbursements (Benicomp, CME, Phone/Internet) now count toward Cash
  Compensation instead of Benefits, since they land directly in your bank
  account rather than being paid to a third party.
- PCR Income Statement page: improved for mobile screens, and rows now show
  the mapped category name instead of the raw PCR-printed label.
- Added Help documentation explaining the PCR Category Mapping feature.

## v3.2.0 — 2026-09-15

- Added a new PCR Income Statement page that reconstructs each year's PCR
  data (revenue, stipends, expenses, other income) month by month.
- PCR Category Mapping extended to cover Other Income labels, not just
  stipends and expenses.
- Fixed an OCR bug where a misread quotation mark could cause a whole
  page's expenses to be miscategorized.
- Mapping settings now show readable category names instead of raw internal
  keys.

## v3.1.0 — 2026-09-02

- Added "Sync from PCR" on the Compensation page to pull yearly expenses in
  from the PCR income statement, with a review step before anything is
  applied.
- Uploading a corrected PCR report no longer silently overwrites previously
  saved numbers for a month — you're now shown what changed and asked to
  confirm before it's applied.

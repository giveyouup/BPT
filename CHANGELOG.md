# Changelog

## v3.11.0 — 2026-09-29

- Fixed the Total Compensation pie chart's legend cutting off text on wide
  screens — it now always shows as a single-column list instead of
  cramming into two columns.
- Settings → PCR Category Mapping: the "Expense Labels" table is no longer
  one long flat list — it's now organized into the same Cash Compensation /
  Business Expenses / Benefits / Retirement Benefits sections used on the
  Compensation and PCR Income Statement pages.

## v3.10.0 — 2026-09-29

- **Cash Compensation redesign.** Rather than a left-over number, Cash
  Compensation is now built up directly from Physician Salary (the PCR's
  MD Salaries line) plus Cash Reimbursements (Benicomp, CME, Phone/
  Internet, Business Meetings, and any custom category you add). The gap
  between that and what's actually accrued so far is shown as "Outstanding
  Salary Balance" — the true-up still owed once the PCR closes out for the
  year, shown in red when negative.
- Compensation's "Gross Revenue Breakdown" and "Other Income" sections are
  renamed "Clinical Revenues Breakdown" and "Non-clinical Revenues" and
  grouped together under a new "Revenues" section, matching how PCR
  Breakdown is already organized.
- The Total Compensation pie chart's legend labels are now clickable for
  drill-down, not just the wedges.
- "Sync from PCR" now applies automatically for any category that's
  currently blank — only a change that would overwrite a value you've
  already entered by hand waits for you to review and apply it.
- Added reminders (in the Sync from PCR preview) when a mapped category
  hasn't been created anywhere yet, and separately when a category you've
  added has no PCR mapping pointing to it — both dismissible.
- Fixed a bug where a dismissed "unmapped PCR label" kept reappearing in
  that same reminder instead of staying hidden.
- Adding a custom category on Compensation (Cash Compensation, Business
  Expenses, Benefits, Retirement, or Other Income) no longer requires
  entering a dollar amount up front — the field stays collapsed until you
  click "+ Add category," and the amount can be filled in then or later,
  same as any other row.
- The PCR Breakdown section on Compensation is now expanded by default.

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

import { useNavigate } from 'react-router-dom'

const TOC = [
  { id: 'quick-start', label: 'Quick Start' },
  { id: 'pcr-report', label: 'Uploading a PCR Report' },
  { id: 'schedule', label: 'Uploading Your Schedule' },
  { id: 'stipends', label: 'Stipend Rate Schedules' },
  { id: 'holidays', label: 'Federal Holidays' },
  { id: 'defaults', label: 'Fixed-Hour Shifts & Defaults' },
  { id: 'cpt-ranges', label: 'CPT Code Ranges' },
  { id: 'backup', label: 'Backup, Restore & Maintenance' },
  { id: 'views', label: 'Where to Find Your Data' },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6 scroll-mt-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">{title}</h3>
      <div className="space-y-3 text-sm text-gray-400 leading-relaxed">{children}</div>
    </section>
  )
}

function Where({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-gray-500">
      <span className="font-semibold text-gray-400">Where:</span> {children}
    </p>
  )
}

export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-100 mb-1">Help &amp; Guide</h2>
      <p className="text-sm text-gray-500 mb-4">
        How to get your schedule, PCR billing, and stipend data into BRACT — and where to find it once it's in.
      </p>

      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-6 text-xs text-gray-500 leading-relaxed">
        This tool was built for my own personal curiosity. It's been tested rigorously, but it can't be
        promised to be free of errors. If you notice anything off, or just need a hand getting set up, please
        reach out to Bijan.
      </div>

      {/* Quick nav */}
      <div className="flex flex-wrap gap-2 mb-8">
        {TOC.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-400 hover:border-indigo-600 hover:text-indigo-300 transition-colors"
          >
            {t.label}
          </a>
        ))}
      </div>

      <Section id="quick-start" title="Quick Start">
        <p>Recommended order for a new setup:</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            In <span className="text-gray-300">Settings → Your Name</span>, enter your name.
          </li>
          <li>
            Configure <span className="text-gray-300">Federal Holidays</span> and a{' '}
            <span className="text-gray-300">Stipend Rate Schedule</span> for the current period in Settings —
            do this before uploading data so call shifts and stipends are classified correctly from day one.
            {' '}The fastest way to get set up is to import a sample database (
            <span className="text-gray-300">Settings → Backup &amp; Restore → Import Backup</span>) that already
            includes the holiday list and stipend rate schedules for 2025 and 2026 — this sample database file is
            provided separately, not by this app. Note that importing a backup{' '}
            <span className="text-amber-400">replaces all existing data</span>, so do this first, before uploading
            any reports or schedules of your own.
          </li>
          <li>
            Import your <span className="text-gray-300">schedule</span> (Upload → Schedule ICS or Grid Paste) —
            this determines working days, shift types, and weekend/holiday classification.
          </li>
          <li>
            Upload your monthly <span className="text-gray-300">PCR report</span> (Upload → PCR Report) once
            billing is processed for that month — this fills in actual units, case times, and hours.
          </li>
          <li>Explore the Dashboard, Annual Summary, Compensation, and Stipend Calculator pages.</li>
        </ol>
      </Section>

      <Section id="pcr-report" title="Uploading a PCR Report">
        <Where>
          <button onClick={() => navigate('/upload')} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
            Upload Report
          </button>{' '}
          → "PCR Report" tab.
        </Where>
        <p>Two ways to get a month's billing data in:</p>
        <div>
          <p className="text-gray-300 font-medium text-xs uppercase tracking-wide mb-1">PDF (easiest)</p>
          <p className="mt-1">
            Drop in a PDF of the Case Distribution Report — it's read with OCR, so there's nothing to
            request from the office first. The report is often bundled with unrelated pages; the correct
            page range is auto-detected, but it's worth a quick check before parsing. Because it's OCR'd
            from a scan, occasional misreads are possible (a garbled ticket number or modifier, for
            example) — spot-check the preview totals against the source PDF, especially for larger reports.
          </p>
        </div>
        <div>
          <p className="text-gray-300 font-medium text-xs uppercase tracking-wide mb-1">Excel export (cleaner, faster)</p>
          <p className="mt-1">
            An Excel (.xlsx) export from the PCR billing system, one row per billing line item — more
            reliable since no OCR is involved, but it has to be requested from Jennifer Greenwell at the
            CASE office. Ideally ask for it on an ongoing monthly basis so each report lines up with one
            calendar month — but an entire year can be imported all at once if needed, at the cost of
            losing monthly granularity. Simply ask her to send the Excel version of the PCR billing
            details page.
          </p>
        </div>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Month and year are auto-detected from the filename or file contents — override manually if needed.</li>
          <li>Dollar Value per Unit pre-fills from a prior report for the same month, if one exists.</li>
          <li>Hours Padding and Default Hours (no-time days) pre-fill from your Settings defaults but can be adjusted per report.</li>
          <li>Re-uploading a month you've already saved shows a conflict warning before it overwrites.</li>
          <li>Excel files spanning 3+ distinct months offer an automatic split into separate monthly reports (a PDF is always a single month, so this doesn't apply).</li>
        </ul>
      </Section>

      <Section id="schedule" title="Uploading Your Schedule">
        <p>Two ways to get shift assignments in — use either one, or both:</p>
        <div>
          <p className="text-gray-300 font-medium text-xs uppercase tracking-wide mb-1">Schedule ICS</p>
          <Where>
            <button onClick={() => navigate('/upload')} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
              Upload Report
            </button>{' '}
            → "Schedule ICS" tab.
          </Where>
          <p className="mt-1">
            An iCalendar (.ics) file exported from your calendar app. Shift assignments must be all-day events,
            with the title containing the shift code (e.g., G1, G2, G3, APS, GI, V, POSTCALL). Multiple events
            on the same day merge into a single entry. After parsing, you can restrict the import to a date range.
          </p>
        </div>
        <div>
          <p className="text-gray-300 font-medium text-xs uppercase tracking-wide mb-1">Grid Paste</p>
          <Where>
            <button onClick={() => navigate('/upload')} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
              Upload Report
            </button>{' '}
            → "Grid Paste" tab.
          </Where>
          <p className="mt-1">Paste one row copied straight out of your schedule spreadsheet, in three steps:</p>
          <ol className="list-decimal pl-5 space-y-1.5 mt-1">
            <li>Pick the month.</li>
            <li>
              <span className="text-gray-300">Weekend selector:</span> by default only weekdays are expected.
              For each weekend in the month, BRACT shows a toggle chip (e.g. "Jul 5–6") — turn it on only if
              that weekend actually has a column (an assignment, including a blocked "\") in your schedule grid.
              Each weekend you enable adds its day(s) to the expected entry count shown below the chips, so the
              pasted row lines up token-for-token with the columns your grid actually has for that month.
            </li>
            <li>
              Paste the row of shift assignments as a single line of text, with a space separating each one —
              for example: <span className="font-mono text-gray-300">G11 G4 BR BIR NIR Endo</span>. This is
              exactly what you get from copying a row straight out of Excel. The number of tokens must match the
              expected entry count exactly. A <span className="font-mono">\</span> token marks a blocked weekend
              and creates no entry for that day.
            </li>
          </ol>
          <p className="mt-1.5">
            If a code is "X" and BRACT can't infer it from context (a Postcall day following a G1/G2 call),
            you'll be asked to resolve it manually before saving.
          </p>
          <p className="mt-1.5">
            <span className="text-gray-300 font-medium">Save button:</span> it only enables once the textbox
            has exactly the right number of entries (and every "X" above has been resolved). If it stays greyed
            out, your row has either missing or extra entries relative to Step 2. Common causes:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>
              An <span className="font-mono">X</span> or <span className="font-mono">/</span> entry in the
              published schedule — only a literal backslash <span className="font-mono">\</span> is recognized
              as a blocked/skip marker. If your grid marks a blocked weekend with <span className="font-mono">/</span>{' '}
              (or anything other than <span className="font-mono">\</span>), paste it as-is and make sure the
              corresponding weekend chip in Step 2 is still toggled on so that day is counted.
            </li>
            <li>
              A <span className="font-mono">V</span> (vacation) stretch that spans a weekend, where the weekend
              chip for that block wasn't toggled on in Step 2 — the pasted row includes tokens for those weekend
              days, but BRACT isn't expecting them yet, so the count comes up short or long.
            </li>
          </ul>
          <p className="mt-1.5 text-amber-400/90">
            Important: each assignment you paste here (G11, BR, NIR, Endo, etc.) must match a key in column A of
            your Stipend Rate Schedule exactly (case-insensitive) for BRACT to pick it up and calculate pay for
            that shift — see the Stipend Rate Schedules section below for the key format.
          </p>
        </div>
        <p className="text-xs text-gray-500">
          Both methods run the same conflict/duplicate check against previously imported schedules for
          overlapping dates before saving.
        </p>
      </Section>

      <Section id="stipends" title="Stipend Rate Schedules">
        <Where>
          <span className="text-gray-300">Settings → Stipend Rate Schedules</span> (or Upload → "Stipend Rates" tab to bring in a new file).
        </Where>
        <p>
          A 2-column Excel spreadsheet: shift type key in column A (e.g., G1_weekday, G1_weekend, APS, BR, NIR, GI),
          dollar amount per shift day in column B.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Append <span className="font-mono text-amber-300">_weekday</span> / <span className="font-mono text-amber-300">_weekend</span>{' '}
            to a key for day-type-specific rates — a plain key with no suffix applies to both.
          </li>
          <li>Call shifts (G1/G2) always resolve via the <span className="font-mono">_weekday</span>/<span className="font-mono">_weekend</span> suffix based on the federal holiday calendar.</li>
          <li><span className="font-mono">ENDO</span> is an alias for <span className="font-mono">GI</span>; GI always uses the <span className="font-mono">_weekend</span> rate regardless of day.</li>
          <li>Fixed-hour shifts (<span className="font-mono">APS</span>, <span className="font-mono">BR</span>, <span className="font-mono">NIR</span>) support plain or weekday/weekend variants too.</li>
        </ul>
        <p>
          Schedules are effective-dated: set the "Effective from" month on upload. Whichever schedule's effective
          date is the most recent one at or before a given month is the one used for it (tagged "current" in the list).
        </p>
        <p>
          You can also duplicate a schedule, edit rates inline, export to CSV, or build one manually without a file.
          If a new or duplicated schedule's effective date overlaps an existing one, BRACT warns you and offers to
          auto-fix the earlier schedule's end date where possible.
        </p>
      </Section>

      <Section id="holidays" title="Federal Holidays">
        <Where><span className="text-gray-300">Settings → Federal Holidays</span>.</Where>
        <p>
          Classifies on-call shifts (G1/G2, and any other shift with a weekend/holiday rate or hours variant) as
          weekday vs. weekend/holiday — used for both stipend rates and fixed-shift hours.
        </p>
        <p>
          Federal holidays for the selected year are pre-populated and enabled by default — untick any your
          institution doesn't observe, and add custom dates (YYYY-MM-DD) for any additional holiday pay days.
        </p>
      </Section>

      <Section id="defaults" title="Fixed-Hour Shifts & Defaults">
        <Where><span className="text-gray-300">Settings → Defaults</span> (collapsible section).</Where>
        <p>
          <span className="text-gray-300 font-medium">Fixed-Hour Shifts</span> — shifts listed here (APS, BR, NIR
          by default; add more as needed) always use a preset hour count for that day instead of deriving it from
          case start/end times. Set a weekday value and, optionally, a separate weekend/holiday value.
        </p>
        <p>
          <span className="text-gray-300 font-medium">Global Defaults</span> — Hours Padding (minutes) is added
          to timed days when computing hours from case times; Default Hours applies to variable-shift days with
          no case time data; Clinical Day Start is the boundary time used to attribute after-midnight cases back
          to the prior call date.
        </p>
      </Section>

      <Section id="cpt-ranges" title="CPT Code Ranges">
        <Where>
          <span className="text-gray-300">Settings → Code Reference → CPT Code Ranges</span>.
        </Where>
        <p>
          Optional. Define numeric CPT/ASA code ranges with a label to tag billing line items with add-on badges
          elsewhere in the app. Not required to get basic tracking working.
        </p>
      </Section>

      <Section id="backup" title="Backup, Restore & Maintenance">
        <Where><span className="text-gray-300">Settings → Backup &amp; Restore</span>.</Where>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><span className="text-gray-300">Export Backup</span> downloads one JSON file with everything: reports, schedules, settings, stipend mappings, and CPT ranges.</li>
          <li><span className="text-gray-300">Import Backup</span> replaces all existing data — you'll be asked to confirm, and a pre-import backup copy is saved automatically.</li>
          <li><span className="text-gray-300">Run Maintenance</span> checkpoints the database's WAL file and compacts it (VACUUM) — safe to run any time.</li>
        </ul>
      </Section>

      <Section id="views" title="Where to Find Your Data">
        <ul className="list-disc pl-5 space-y-2">
          <li><span className="text-gray-300 font-medium">Dashboard</span> — current month at a glance plus YTD stats; empty until your first PCR report is uploaded.</li>
          <li>
            <span className="text-gray-300 font-medium">Annual Summary</span> — yearly charts and shift-type
            analytics. Charts built from billing-derived numbers (hours, units, dollar/unit trend, end-of-day
            distribution, per-shift-type breakdowns) automatically stop at the most recent date with processed
            billing data — a banner above the charts shows that cutoff.
          </li>
          <li>
            <span className="text-gray-300 font-medium">Compensation</span> — accrual view (by PCR billing period)
            by default; switch to Cash view for calendar-year cash-received tracking, with an editable per-year cutoff date.
          </li>
          <li>
            <span className="text-gray-300 font-medium">Stipend Calculator</span> — monthly stipend totals by
            shift-code group. Use the gear icon to promote specific shift codes (and independently, their
            weekend/holiday occurrences) out of "Other G"/"Other" into their own column. Toggle between Accrual
            (numbers shown for the month they were earned) and PCR (each row shows the prior month's numbers,
            matching how PCR pay periods lag).
          </li>
          <li><span className="text-gray-300 font-medium">Schedule Calendar</span> — month-by-month calendar view of imported shifts, with manual add/edit per day.</li>
          <li><span className="text-gray-300 font-medium">Audits</span> — reconciliation and discrepancy checks across reports and schedules.</li>
        </ul>
      </Section>
    </div>
  )
}

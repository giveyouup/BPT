import type { AnnualExpenses, ExpenseEntry, PcrCategoryMapping, PcrIncomeStatement } from '../types'
import { resolvePcrCategoryMapping } from './pcrCategoryMatching'
import { BUSINESS_KEYS, KNOWN_RECURRING_KEYS, LEAF_LABELS } from './expenseCategories'
import { randomId } from './dateUtils'

/** Which of AnnualExpenses' four free-form entries arrays a category lives in. */
export type ExpenseGroup = 'cashComp' | 'business' | 'benefits' | 'retirement'

const GROUP_FIELD: Record<ExpenseGroup, keyof AnnualExpenses> = {
  cashComp: 'cashCompEntries',
  business: 'entries',
  benefits: 'benefitsEntries',
  retirement: 'retirementEntries',
}

/**
 * A free-form (non-fixed-leaf) category's home is established the moment a
 * user adds it via a specific section's own "Add" form -- not guessed. Once
 * created (in any year), it stays that category's home in every other year
 * too, matching the PCR Income Statement page's own existing cross-year
 * bucket-placement behavior.
 */
export function findExpenseCategoryHome(allAnnualExpenses: AnnualExpenses[], category: string): ExpenseGroup | null {
  for (const rec of allAnnualExpenses) {
    for (const group of Object.keys(GROUP_FIELD) as ExpenseGroup[]) {
      const arr = rec[GROUP_FIELD[group]] as ExpenseEntry[] | undefined
      if ((arr ?? []).some((e) => e.category === category)) return group
    }
  }
  return null
}

export interface PcrSyncChange {
  key: string
  label: string
  current: number
  proposed: number
  section: 'expense' | 'otherIncome'
  /** Only set for a free-form (non-fixed-leaf) 'expense' change: which entries array it resolved to. */
  group?: ExpenseGroup
}

/** A PCR label mapped to a free-form category that's never been created in any section yet -- nothing to sync until the user adds it once. */
export interface PcrSyncNeedsHome {
  pcrLabel: string
  category: string
}

export interface PcrSyncPreview {
  changes: PcrSyncChange[]
  unmappedLabels: string[]
  needsHomeLabels: PcrSyncNeedsHome[]
  categoriesWithoutMapping: string[]
}

/**
 * The mirror image of `needsHomeLabels`: a free-form category that's been
 * created (in any year, any section) but has no PCR mapping targeting it at
 * all, so it'll never receive anything from a PCR sync until one exists.
 * Cross-year and independent of which year's preview is being built, since
 * "does a mapping exist for this category" isn't a per-year question.
 * `dismissedCategories` lets a deliberately hand-managed category (never
 * meant to sync from the PCR) opt out of the reminder permanently.
 */
export function findCategoriesWithoutMapping(
  allAnnualExpenses: AnnualExpenses[],
  pcrCategoryMappings: PcrCategoryMapping[],
  dismissedCategories: string[] = [],
): string[] {
  const allCategories = new Set<string>()
  for (const rec of allAnnualExpenses) {
    for (const group of Object.keys(GROUP_FIELD) as ExpenseGroup[]) {
      for (const e of (rec[GROUP_FIELD[group]] as ExpenseEntry[] | undefined) ?? []) allCategories.add(e.category)
    }
  }
  const mappedTargets = new Set(pcrCategoryMappings.filter((m) => m.section === 'expense').map((m) => m.targetKey))
  return [...allCategories].filter((c) => !mappedTargets.has(c) && !dismissedCategories.includes(c)).sort()
}

/**
 * Sums each PCR expense/other-income line (via PcrCategoryMapping) across
 * every income statement for the given year -- no payout lag here, unlike
 * stipends; a PCR's expense column reflects that same month's own costs.
 *
 * "Operating Reserves" items (operating fee, development reserve, the flat
 * operating expense) sit before the PCR's own EXPENSES header opens, so
 * extraction tags them 'other' rather than 'expense' -- but they're still
 * real Compensation-page categories, so a mapping can still target them.
 * Restricted to Business Expenses keys specifically (the only category real
 * Operating Reserves items ever belong to): a broader "any mapped 'other'
 * line" rule also swept in unrelated 'other' lines whose label happens to
 * share a substring with a mapping meant for something else entirely (e.g.
 * "Cash Balance Plan - PCR Reserve", a distinct reserve/catch-up adjustment,
 * matching the "Cash Balance Plan" mapping and inflating that retirement
 * total). Everything else under 'other' is a revenue/balance rollup that was
 * never meant to be categorized, so an unmapped 'other' line is never
 * flagged the way an unmapped 'expense' line is.
 *
 * A free-form expense target with no established home anywhere yet is left
 * out of `proposedExpense` entirely (see findExpenseCategoryHome) and
 * surfaced via `needsHome` instead -- sync never guesses which section a
 * brand-new custom category belongs in.
 */
function computePcrProposals(
  year: number,
  pcrIncomeStatements: PcrIncomeStatement[],
  pcrCategoryMappings: PcrCategoryMapping[],
  allAnnualExpenses: AnnualExpenses[],
  hiddenExpenseLabels: string[],
  hiddenOtherIncomeLabels: string[],
): {
  proposedExpense: Record<string, number>
  proposedGroup: Record<string, ExpenseGroup>
  proposedOtherIncome: Record<string, number>
  unmapped: Set<string>
  needsHome: Map<string, PcrSyncNeedsHome>
} {
  const proposedExpense: Record<string, number> = {}
  const proposedGroup: Record<string, ExpenseGroup> = {}
  const proposedOtherIncome: Record<string, number> = {}
  const unmapped = new Set<string>()
  const needsHome = new Map<string, PcrSyncNeedsHome>()

  for (const stmt of pcrIncomeStatements) {
    if (stmt.year !== year) continue
    for (const line of stmt.lines) {
      if (line.section === 'otherIncome') {
        const mapping = resolvePcrCategoryMapping(line.label, 'otherIncome', pcrCategoryMappings)
        if (!mapping) { if (!hiddenOtherIncomeLabels.includes(line.label)) unmapped.add(line.label); continue }
        proposedOtherIncome[mapping.targetKey] = (proposedOtherIncome[mapping.targetKey] ?? 0) + line.amount
        continue
      }
      if (line.section !== 'expense' && line.section !== 'other') continue
      const mapping = resolvePcrCategoryMapping(line.label, 'expense', pcrCategoryMappings)
      if (!mapping) { if (line.section === 'expense' && !hiddenExpenseLabels.includes(line.label)) unmapped.add(line.label); continue }
      if (line.section === 'other' && !BUSINESS_KEYS.has(mapping.targetKey)) continue

      const key = mapping.targetKey
      if (!KNOWN_RECURRING_KEYS.has(key)) {
        const home = findExpenseCategoryHome(allAnnualExpenses, key)
        if (!home) {
          if (!hiddenExpenseLabels.includes(line.label) && !needsHome.has(key)) {
            needsHome.set(key, { pcrLabel: line.label, category: key })
          }
          continue
        }
        proposedGroup[key] = home
      }
      proposedExpense[key] = (proposedExpense[key] ?? 0) + line.amount
    }
  }

  return { proposedExpense, proposedGroup, proposedOtherIncome, unmapped, needsHome }
}

/** A known leaf key's current value lives in `recurring[key]`; a free-form category's lives in whichever array its established home resolves to. */
function currentExpenseValue(record: AnnualExpenses | undefined, key: string, group: ExpenseGroup | undefined): number {
  if (KNOWN_RECURRING_KEYS.has(key)) return record?.recurring?.[key] ?? 0
  const arr = group ? (record?.[GROUP_FIELD[group]] as ExpenseEntry[] | undefined) : record?.entries
  return (arr ?? []).filter((e) => e.category === key).reduce((s, e) => s + e.amount, 0)
}

/**
 * Every category whose PCR-proposed total differs from what's currently
 * entered by more than a cent. `allAnnualExpenses` (every year, not just
 * `year`) is needed to resolve a free-form category's established home --
 * only that one year's `record` is ever written to.
 */
export function buildPcrSyncPreview(
  year: number,
  pcrIncomeStatements: PcrIncomeStatement[],
  pcrCategoryMappings: PcrCategoryMapping[],
  allAnnualExpenses: AnnualExpenses[],
  record: AnnualExpenses | undefined,
  hiddenExpenseLabels: string[] = [],
  dismissedCategories: string[] = [],
  hiddenOtherIncomeLabels: string[] = [],
): PcrSyncPreview {
  const { proposedExpense, proposedGroup, proposedOtherIncome, unmapped, needsHome } =
    computePcrProposals(year, pcrIncomeStatements, pcrCategoryMappings, allAnnualExpenses, hiddenExpenseLabels, hiddenOtherIncomeLabels)
  const changes: PcrSyncChange[] = []

  for (const [key, proposedAmt] of Object.entries(proposedExpense)) {
    const rounded = Math.round(proposedAmt * 100) / 100
    const group = proposedGroup[key]
    const current = currentExpenseValue(record, key, group)
    if (Math.abs(rounded - current) < 0.01) continue
    changes.push({ key, label: LEAF_LABELS[key] ?? key, current, proposed: rounded, section: 'expense', group })
  }
  for (const [key, proposedAmt] of Object.entries(proposedOtherIncome)) {
    const rounded = Math.round(proposedAmt * 100) / 100
    const current = (record?.otherIncomeEntries ?? []).filter((e) => e.category === key).reduce((s, e) => s + e.amount, 0)
    if (Math.abs(rounded - current) < 0.01) continue
    changes.push({ key, label: key, current, proposed: rounded, section: 'otherIncome' })
  }
  changes.sort((a, b) => a.label.localeCompare(b.label))

  return {
    changes,
    unmappedLabels: [...unmapped].sort(),
    needsHomeLabels: [...needsHome.values()].sort((a, b) => a.category.localeCompare(b.category)),
    categoriesWithoutMapping: findCategoriesWithoutMapping(allAnnualExpenses, pcrCategoryMappings, dismissedCategories),
  }
}

/**
 * A known leaf key updates `recurring[key]` directly; a free-form category
 * upserts into whichever entries array `change.group` resolved to (matching
 * category name, so re-syncing updates the same entry instead of piling up
 * duplicates) -- Business Expenses' `entries[]` for an other-income change,
 * since that section has no group concept of its own.
 */
export function applyPcrSyncChanges(record: AnnualExpenses, changes: PcrSyncChange[]): AnnualExpenses {
  const recurringUpdates: Record<string, number> = {}
  const groupUpdates: Partial<Record<ExpenseGroup, ExpenseEntry[]>> = {}
  const otherIncomeEntries = [...(record.otherIncomeEntries ?? [])]

  function groupArray(group: ExpenseGroup): ExpenseEntry[] {
    if (!groupUpdates[group]) groupUpdates[group] = [...((record[GROUP_FIELD[group]] as ExpenseEntry[] | undefined) ?? [])]
    return groupUpdates[group]!
  }

  for (const change of changes) {
    if (change.section === 'otherIncome') {
      const idx = otherIncomeEntries.findIndex((e) => e.category === change.key)
      if (idx >= 0) otherIncomeEntries[idx] = { ...otherIncomeEntries[idx], amount: change.proposed }
      else if (change.proposed !== 0) otherIncomeEntries.push({ id: randomId(), category: change.key, amount: change.proposed })
    } else if (KNOWN_RECURRING_KEYS.has(change.key)) {
      recurringUpdates[change.key] = change.proposed
    } else {
      const arr = groupArray(change.group ?? 'business')
      const idx = arr.findIndex((e) => e.category === change.key)
      if (idx >= 0) arr[idx] = { ...arr[idx], amount: change.proposed }
      else if (change.proposed !== 0) arr.push({ id: randomId(), category: change.key, amount: change.proposed })
    }
  }

  const fieldUpdates: Partial<AnnualExpenses> = {}
  for (const group of Object.keys(groupUpdates) as ExpenseGroup[]) {
    const field = GROUP_FIELD[group] as 'entries' | 'cashCompEntries' | 'benefitsEntries' | 'retirementEntries'
    fieldUpdates[field] = groupUpdates[group]!.filter((e) => e.amount !== 0)
  }

  return {
    ...record,
    ...fieldUpdates,
    recurring: { ...(record.recurring ?? {}), ...recurringUpdates },
    otherIncomeEntries: otherIncomeEntries.filter((e) => e.amount !== 0),
  }
}

/**
 * Auto-applies only the "safe" half of a sync -- categories with no existing
 * value at all (current === 0), i.e. first-time population with nothing to
 * lose. A change that would overwrite an existing non-zero value is left
 * alone here; that's exactly the case where a restated/misread PCR figure
 * or a deliberate manual override could otherwise be silently clobbered, so
 * it stays behind Compensation's own manual "Sync from PCR" review instead.
 * A free-form category with no established home is never "safe" -- it's
 * already excluded from `changes` entirely (see buildPcrSyncPreview).
 * Called automatically after a PCR upload (see Upload.tsx) so a first-time
 * or newly-added category (e.g. Physician Salary, Business Meetings) doesn't
 * require a manual sync click. Returns the updated record, or null if there
 * was nothing safe to apply.
 */
export function applySafePcrSync(
  year: number,
  pcrIncomeStatements: PcrIncomeStatement[],
  pcrCategoryMappings: PcrCategoryMapping[],
  allAnnualExpenses: AnnualExpenses[],
  record: AnnualExpenses,
): AnnualExpenses | null {
  const preview = buildPcrSyncPreview(year, pcrIncomeStatements, pcrCategoryMappings, allAnnualExpenses, record)
  const safeChanges = preview.changes.filter((c) => c.current === 0)
  if (safeChanges.length === 0) return null
  return applyPcrSyncChanges(record, safeChanges)
}

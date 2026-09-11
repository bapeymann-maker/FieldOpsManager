// Task Orchestrator — framework-agnostic scheduling logic + types.
// Pure functions only: no DOM, no React, no Supabase. Ported from the prototype.

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskType = { id: string; name: string }

export type OrchestratorField = {
  id: string
  name: string
  active: boolean
  region: string | null // 'North' | 'South' | ...
  client: string | null // e.g. 'LB Pork'
}

// Mirrors the SECTIONS grouping on the main calendar (app/page.tsx) so the
// orchestrator's field picker matches it exactly.
export type FieldSection = 'North' | 'South' | 'LB Pork'

export const FIELD_SECTIONS: { key: FieldSection; label: string }[] = [
  { key: 'North', label: 'Northern Operation' },
  { key: 'South', label: 'Southern Operation' },
  { key: 'LB Pork', label: 'LB Pork' },
]

/** LB Pork wins regardless of region — same precedence as the main calendar's SECTIONS filters. */
export function fieldSectionOf(f: Pick<OrchestratorField, 'region' | 'client'>): FieldSection | null {
  if (f.client === 'LB Pork') return 'LB Pork'
  if (f.region === 'North') return 'North'
  if (f.region === 'South') return 'South'
  return null
}

export function fieldsInSection(fields: OrchestratorField[], section: FieldSection): OrchestratorField[] {
  return fields.filter((f) => fieldSectionOf(f) === section)
}

export type ResourceKind = 'asset' | 'employee'

export type Resource = {
  id: string
  name: string
  type: ResourceKind
  shift_start: number | null
  shift_end: number | null
  // Weekdays this resource works at all: 0=Sunday..6=Saturday. null/empty
  // means every day — for part-time / certain-days-only workers.
  available_days: number[] | null
  // Free-text subgrouping, meaning depends on `type`: equipment category for
  // assets (Combine, Tractor, ...), shift bucket for employees (Day Shift,
  // Night Shift, Part-Time). Presets live in ASSET_CATEGORIES / EMPLOYEE_SHIFTS
  // below; not DB-constrained so new ones don't need a migration.
  category: string | null
  // Org unit — currently only meaningful for employees (Ufer / LB Pork,
  // matching fields.client). Null for assets.
  division: string | null
  active: boolean
  source: 'john_deere' | 'manual'
  external_id: string | null
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const ASSET_CATEGORIES = [
  'Combine',
  'Tractor',
  'Cart',
  'Semi',
  'Trailer',
  'Grain Cart',
  'Implement',
] as const

export const EMPLOYEE_DIVISIONS = ['Ufer', 'LB Pork'] as const

export const EMPLOYEE_SHIFTS = ['Day Shift', 'Night Shift', 'Part-Time'] as const

export type ResourceGroup = { label: string; items: Resource[] }

const UNGROUPED = 'Other'

/** Assets grouped by category, in ASSET_CATEGORIES order, "Other" last. */
/**
 * Task types that only ever use a specific slice of equipment — the
 * Equipment picker filters to just these categories (and drops the
 * "Other/uncategorized" catch-all, since something uncategorized can't be
 * confirmed to belong). Task types not listed here show every category.
 */
export const TASK_TYPE_EQUIPMENT_CATEGORIES: Record<string, string[]> = {
  Hauling: ['Semi', 'Trailer'],
  Harvest: ['Tractor', 'Grain Cart'],
}

export function equipmentCategoriesForTaskType(taskTypeName: string | undefined): string[] | null {
  if (!taskTypeName) return null
  return TASK_TYPE_EQUIPMENT_CATEGORIES[taskTypeName] ?? null
}

/**
 * Assets grouped by category, in ASSET_CATEGORIES order, "Other" last.
 * Pass `allowedCategories` (e.g. from equipmentCategoriesForTaskType) to
 * restrict to just those categories, in the order given, with no "Other"
 * bucket — used for task types that only ever use specific equipment.
 */
export function groupAssetsByCategory(resources: Resource[], allowedCategories?: string[] | null): ResourceGroup[] {
  const assets = resources.filter((r) => {
    if (r.type !== 'asset') return false
    if (!allowedCategories) return true
    return !!r.category && allowedCategories.includes(r.category)
  })
  const byCat = new Map<string, Resource[]>()
  for (const r of assets) {
    const cat = r.category || UNGROUPED
    const list = byCat.get(cat)
    if (list) list.push(r)
    else byCat.set(cat, [r])
  }
  const order = allowedCategories ?? [...ASSET_CATEGORIES, UNGROUPED]
  return order.filter((cat) => byCat.has(cat)).map((cat) => ({ label: cat, items: byCat.get(cat)! }))
}

/** Employees grouped by division — Ufer before LB Pork, "Other" (unassigned) last. */
export function groupEmployeesByDivision(resources: Resource[]): ResourceGroup[] {
  const employees = resources.filter((r) => r.type === 'employee')
  const byDiv = new Map<string, Resource[]>()
  for (const r of employees) {
    const div = r.division || UNGROUPED
    const list = byDiv.get(div)
    if (list) list.push(r)
    else byDiv.set(div, [r])
  }
  const order = [...EMPLOYEE_DIVISIONS, UNGROUPED]
  return order.filter((div) => byDiv.has(div)).map((div) => ({ label: div, items: byDiv.get(div)! }))
}

export type DefaultGroup = {
  id: string
  task_type_id: string
  name: string
  shift_start: number | null
  shift_end: number | null
  resource_ids: string[]
}

// Generic, task-type-specific extra structured data (currently only Hauling
// uses it, as HaulDetails below). Kept loosely typed here — validate/cast at
// the point of use, keyed off task_type_id / task type name.
export type TaskDetails = Record<string, unknown>

export type Task = {
  id: string
  title: string
  task_type_id: string
  field_id: string | null
  task_date: string // 'YYYY-MM-DD'
  start_hour: number // may exceed 24 when the task crosses midnight
  end_hour: number // may exceed 24
  all_day: boolean
  completed: boolean
  completed_at: string | null
  resource_ids: string[]
  details: TaskDetails | null
}

export type NewTaskInput = {
  title: string
  task_type_id: string
  field_id: string | null
  task_date: string
  start_hour: number
  end_hour: number
  all_day: boolean
  details?: TaskDetails | null
}

// ── Hauling: origin/destination picker data ─────────────────────────────────

export const HAUL_COMMODITIES = ['Corn', 'Soybeans', 'Oats'] as const
export type HaulCommodity = (typeof HAUL_COMMODITIES)[number]

// Bin sites and their individual bin numbers/letters. A site with an empty
// `bins` array (Ben's) is itself the full answer — no number to pick.
export const BIN_SITES: { site: string; bins: string[] }[] = [
  { site: 'Home Farm', bins: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'A', 'B'] },
  { site: 'Mau', bins: ['41', '42', '43'] },
  { site: "Ben's", bins: [] },
  { site: 'Fancher', bins: ['31', '32', '33', '34', '35'] },
  { site: "Ryan's", bins: ['20', '22', '23', '25'] },
  { site: 'Danube', bins: ['D1', 'D2', 'D3', 'C1', 'C2', 'C3', 'C4', 'C5'] },
  { site: 'Hanson Silo', bins: ['West', 'Middle', 'East'] },
  { site: 'Fairfax', bins: ['1', '2', '3', '4'] },
]

export const ELEVATORS = [
  'CHS Fairmont',
  'Valero-Hartley',
  'Dakota City Nebraska',
  'Valero-Welcome',
  'Cargill-Madison',
  'Frontier Family Farms',
  'FW COB',
  'Grain Millers',
  'LB Pork',
  'Redwood Falls',
] as const

export type HaulLocation =
  | { kind: 'field'; field_id: string | null }
  | { kind: 'bin'; site: string; bin: string | null }
  | { kind: 'home_farm_wet_bin' }
  | { kind: 'lb_pork_delivery' }
  | { kind: 'elevator'; name: string }
  | { kind: 'other'; note: string }

export type HaulDetails = {
  commodity: HaulCommodity
  origin: HaulLocation
  destination: HaulLocation
}

export function formatHaulLocation(loc: HaulLocation, fields: OrchestratorField[]): string {
  switch (loc.kind) {
    case 'field': {
      const f = loc.field_id ? fields.find((x) => x.id === loc.field_id) : null
      return f ? f.name : 'Field'
    }
    case 'bin':
      return loc.bin ? `${loc.site} ${loc.bin}` : loc.site
    case 'home_farm_wet_bin':
      return 'Home Farm Wet Bin'
    case 'lb_pork_delivery':
      return 'Delivery_LB_Pork'
    case 'elevator':
      return loc.name
    case 'other':
      return loc.note || 'Other'
  }
}

// ── Availability (wrap-aware shift windows) ─────────────────────────────────

/**
 * Is hour `h` (0-24, fractional ok) inside the [start, end) shift window?
 * `null` start or end means the resource is always available.
 * `end < start` means the window wraps past midnight (e.g. 20 -> 4).
 */
export function hourInWindow(h: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return true
  const hh = ((h % 24) + 24) % 24
  if (start === end) return true // full-day window
  if (start < end) return hh >= start && hh < end
  return hh >= start || hh < end // wraps past midnight
}

/** Is this resource scheduled to work at all on the weekday of `dateStr`? null/empty = every day. */
export function isDayAvailable(resource: Pick<Resource, 'available_days'>, dateStr: string): boolean {
  if (!resource.available_days || resource.available_days.length === 0) return true
  const dow = parseDateStr(dateStr).getDay()
  return resource.available_days.includes(dow)
}

export function formatAvailableDays(days: number[] | null): string {
  if (!days || days.length === 0 || days.length >= 7) return 'Every day'
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d])
    .join(', ')
}

/**
 * Event-range version of the same check: does any part of `task` fall outside
 * the resource's day-of-week / shift window? All-day tasks skip the hour check
 * (but not the day check); always-available resources are never "outside".
 */
export function isOutsideAvailability(
  resource: Pick<Resource, 'shift_start' | 'shift_end' | 'available_days'>,
  task: Pick<Task, 'start_hour' | 'end_hour' | 'all_day' | 'task_date'>,
): boolean {
  if (!isDayAvailable(resource, task.task_date)) return true
  if (resource.shift_start == null || resource.shift_end == null) return false
  if (task.all_day) return false
  const step = 0.25
  for (let h = task.start_hour; h < task.end_hour - 1e-9; h += step) {
    if (!hourInWindow(h, resource.shift_start, resource.shift_end)) return true
  }
  return false
}

// ── Time ranges & conflict detection ───────────────────────────────────────

export function taskSpan(t: Pick<Task, 'start_hour' | 'end_hour' | 'all_day'>): [number, number] {
  if (t.all_day) return [0, 24]
  return [t.start_hour, t.end_hour]
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** Same day + overlapping time range. Completed tasks never conflict. */
export function tasksOverlap(a: Task, b: Task): boolean {
  if (a.id === b.id) return false
  if (a.completed || b.completed) return false
  if (a.task_date !== b.task_date) return false
  const [as, ae] = taskSpan(a)
  const [bs, be] = taskSpan(b)
  return rangesOverlap(as, ae, bs, be)
}

/** resourceId -> set of task ids that double-book that resource. */
export function findConflicts(tasks: Task[]): Map<string, Set<string>> {
  const byResource = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.completed) continue
    for (const rid of t.resource_ids) {
      const list = byResource.get(rid)
      if (list) list.push(t)
      else byResource.set(rid, [t])
    }
  }
  const conflicts = new Map<string, Set<string>>()
  for (const [rid, list] of byResource) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (tasksOverlap(list[i], list[j])) {
          const set = conflicts.get(rid) ?? new Set<string>()
          set.add(list[i].id)
          set.add(list[j].id)
          conflicts.set(rid, set)
        }
      }
    }
  }
  return conflicts
}

/** Flat set of every task id involved in at least one resource conflict. */
export function conflictedTaskIds(tasks: Task[]): Set<string> {
  const out = new Set<string>()
  for (const ids of findConflicts(tasks).values()) for (const id of ids) out.add(id)
  return out
}

/** Is `resourceId` on an active task covering `hour` on `dateStr`? */
export function resourceBusyAt(
  resourceId: string,
  dateStr: string,
  hour: number,
  tasks: Task[],
): boolean {
  return tasks.some((t) => {
    if (t.completed || t.task_date !== dateStr || !t.resource_ids.includes(resourceId)) return false
    const [s, e] = taskSpan(t)
    return hour >= s && hour < e
  })
}

export type ResourceStatus = 'available' | 'busy' | 'off-shift' | 'conflict'

/** Status of a resource "now" (for the resource pool chips). */
/**
 * Status of a resource at a specific (date, hour) — the general form, used to
 * drive the Day view's scrub-cursor ("what's available at 2pm Thursday?").
 */
export function resourceStatusAt(
  resource: Resource,
  dateStr: string,
  hour: number,
  tasks: Task[],
): ResourceStatus {
  if (!isDayAvailable(resource, dateStr)) return 'off-shift'
  const conflicts = findConflicts(tasks).get(resource.id)
  if (conflicts && conflicts.size) return 'conflict'
  if (resourceBusyAt(resource.id, dateStr, hour, tasks)) return 'busy'
  if (!hourInWindow(hour, resource.shift_start, resource.shift_end)) return 'off-shift'
  return 'available'
}

/**
 * Status of a resource "right now" (wall-clock). Only evaluates busy/off-shift
 * against the live hour when `dateStr` is actually today — viewing a future
 * or past date with no cursor falls back to day-availability + conflict only,
 * since "busy right now" isn't a meaningful question for a different day.
 */
export function resourceStatusNow(
  resource: Resource,
  dateStr: string,
  now: Date,
  tasks: Task[],
): ResourceStatus {
  if (isSameLocalDay(now, dateStr)) {
    return resourceStatusAt(resource, dateStr, now.getHours() + now.getMinutes() / 60, tasks)
  }
  if (!isDayAvailable(resource, dateStr)) return 'off-shift'
  const conflicts = findConflicts(tasks).get(resource.id)
  if (conflicts && conflicts.size) return 'conflict'
  return 'available'
}

// ── Scrub line (midnight-rollover: pure scroll-position math) ───────────────

/** Day timeline: pixels from the top of the hour grid for "now". */
export function scrubLineTop(now: Date, hourHeight: number, dayStartHour = 0): number {
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  return (h - dayStartHour) * hourHeight
}

/** Day timeline (horizontal track): fraction 0-1 across a 24h track for "now". */
export function scrubLineFraction(now: Date): number {
  return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400
}

export function isSameLocalDay(now: Date, dateStr: string): boolean {
  return toDateStr(now) === dateStr
}

// ── Date helpers ───────────────────────────────────────────────────────────

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDateStr(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00')
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateStr(dateStr)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function startOfWeek(dateStr: string): string {
  const d = parseDateStr(dateStr)
  return addDays(dateStr, -d.getDay()) // week starts Sunday, matching the rest of the app
}

export function weekDays(startDateStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startDateStr, i))
}

export function formatDateLong(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateShort(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
}

/** "8 AM", "1:30 PM", "12 AM" — accepts hours >= 24 (wraps). */
export function formatHour(h: number): string {
  const base = Math.floor(h)
  const hh = ((base % 24) + 24) % 24
  const mins = Math.round((h - base) * 60)
  const ampm = hh < 12 ? 'AM' : 'PM'
  const disp = hh % 12 === 0 ? 12 : hh % 12
  return mins ? `${disp}:${String(mins).padStart(2, '0')} ${ampm}` : `${disp} ${ampm}`
}

export function formatShiftWindow(start: number | null, end: number | null): string {
  if (start == null || end == null) return 'Any time'
  return `${formatHour(start)}–${formatHour(end)}`
}

/**
 * Parses a free-typed shift-hour field into an integer 0-23, or null for
 * "any time" (blank/invalid). `resources.shift_start`/`shift_end` are
 * DB-constrained to 0-23 — 24 isn't a valid hour there because "midnight" is
 * already hour 0 in the wrap-around window model (hourInWindow treats
 * shift_end < shift_start as wrapping past midnight). Typing 24 for "works
 * until midnight" is a natural mistake, so it's normalized to 0 rather than
 * rejected outright.
 */
export function parseShiftHour(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return ((Math.round(n) % 24) + 24) % 24
}

// ── Resource pairings (tractor+implement, operator+equipment, semi+trailer) ─

/** An undirected pairing edge — always stored/read with a < b. */
export type ResourcePairing = { a: string; b: string }

const PAIRABLE_ASSET_CATEGORIES = new Set(['Tractor|Implement', 'Tractor|Grain Cart', 'Semi|Trailer'])
const OPERATOR_CATEGORIES = new Set(['Tractor', 'Semi', 'Combine'])

/** Can these two resources be paired as a default equipment/operator set? */
export function canPair(a: Resource, b: Resource): boolean {
  if (a.id === b.id) return false
  const isEmpA = a.type === 'employee'
  const isEmpB = b.type === 'employee'
  if (isEmpA && isEmpB) return false
  if (isEmpA) return OPERATOR_CATEGORIES.has(b.category ?? '')
  if (isEmpB) return OPERATOR_CATEGORIES.has(a.category ?? '')
  const catA = a.category ?? ''
  const catB = b.category ?? ''
  return PAIRABLE_ASSET_CATEGORIES.has(`${catA}|${catB}`) || PAIRABLE_ASSET_CATEGORIES.has(`${catB}|${catA}`)
}

/** Every resource currently paired with `resource`, per the given pairing set. */
export function pairedWith(resource: Resource, pairings: ResourcePairing[]): string[] {
  return pairings
    .filter((p) => p.a === resource.id || p.b === resource.id)
    .map((p) => (p.a === resource.id ? p.b : p.a))
}

/**
 * Groups a task's assigned resources into pairing clusters — connected
 * components using only pairing edges where *both* ends are actually on this
 * task — for the daily report. A resource with no paired partner on the task
 * comes back as its own single-item cluster.
 */
export function clusterPairedResources(resourceIds: string[], pairings: ResourcePairing[]): string[][] {
  const idSet = new Set(resourceIds)
  const adjacency = new Map<string, Set<string>>()
  for (const id of resourceIds) adjacency.set(id, new Set())
  for (const p of pairings) {
    if (idSet.has(p.a) && idSet.has(p.b)) {
      adjacency.get(p.a)?.add(p.b)
      adjacency.get(p.b)?.add(p.a)
    }
  }
  const seen = new Set<string>()
  const clusters: string[][] = []
  for (const id of resourceIds) {
    if (seen.has(id)) continue
    const cluster: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      cluster.push(cur)
      for (const next of adjacency.get(cur) ?? []) if (!seen.has(next)) stack.push(next)
    }
    clusters.push(cluster)
  }
  return clusters
}

// ── Daily report ─────────────────────────────────────────────────────────

/** Plain-text daily task list, grouped by pairing, for copying out to the crew. */
export function buildDailyReportText(
  dateStr: string,
  tasks: Task[],
  taskTypes: TaskType[],
  fields: OrchestratorField[],
  resources: Resource[],
  pairings: ResourcePairing[],
): string {
  const typeById = new Map(taskTypes.map((t) => [t.id, t]))
  const fieldById = new Map(fields.map((f) => [f.id, f]))
  const resourceById = new Map(resources.map((r) => [r.id, r]))
  const dayTasks = tasks
    .filter((t) => t.task_date === dateStr)
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return a.start_hour - b.start_hour
    })

  const lines: string[] = [`FIELD OPS — ${formatDateLong(dateStr)}`, '']

  if (dayTasks.length === 0) {
    lines.push('No tasks scheduled.')
    return lines.join('\n')
  }

  for (const t of dayTasks) {
    const type = typeById.get(t.task_type_id)
    const field = t.field_id ? fieldById.get(t.field_id) : undefined
    const timeStr = t.all_day ? 'All day' : `${formatHour(t.start_hour)}–${formatHour(t.end_hour)}`
    const titleParts = [type?.name, field?.name, t.title].filter(Boolean)
    lines.push(`${t.completed ? '[DONE] ' : ''}${timeStr} — ${titleParts.join(' / ')}`)

    if (type?.name === 'Hauling' && t.details) {
      const haul = t.details as HaulDetails
      lines.push(
        `  ${haul.commodity}: ${formatHaulLocation(haul.origin, fields)} -> ${formatHaulLocation(haul.destination, fields)}`,
      )
    }

    const clusters = clusterPairedResources(t.resource_ids, pairings)
    if (clusters.length === 0) {
      lines.push('  (no resources assigned)')
    } else {
      for (const cluster of clusters) {
        const names = cluster
          .map((id) => resourceById.get(id)?.name)
          .filter((n): n is string => !!n)
        if (names.length) lines.push(`  ${names.join(' + ')}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

'use client'

import React, { useMemo, useState } from 'react'
import {
  ASSET_CATEGORIES,
  DAY_LABELS,
  EMPLOYEE_DIVISIONS,
  EMPLOYEE_SHIFTS,
  type Resource,
  type ResourceKind,
  type Task,
  formatAvailableDays,
  formatShiftWindow,
  parseShiftHour,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C, STATUS_COLOR } from './ui'

export type ResourcePatch = Partial<{
  name: string
  type: ResourceKind
  shift_start: number | null
  shift_end: number | null
  available_days: number[] | null
  category: string | null
  division: string | null
  active: boolean
}>

type NewResourceInput = {
  name: string
  type: ResourceKind
  shift_start: number | null
  shift_end: number | null
  available_days: number[] | null
  category: string | null
  division: string | null
}

type Props = {
  resources: Resource[]
  tasks: Task[] // tasks for the currently viewed date
  dateStr: string
  now: Date
  onAddResource?: (input: NewResourceInput) => void
  onUpdateResource?: (id: string, patch: ResourcePatch) => void
}

const ALL_DAYS = new Set([0, 1, 2, 3, 4, 5, 6])
const UNASSIGNED = 'Unassigned'

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  busy: 'On a task',
  'off-shift': 'Off shift',
  conflict: 'Double-booked',
}

type PanelState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; resourceId: string }

export default function ResourcePool({
  resources,
  tasks,
  dateStr,
  now,
  onAddResource,
  onUpdateResource,
}: Props) {
  const [panel, setPanel] = useState<PanelState>({ mode: 'closed' })
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ResourceKind>('asset')
  const [shiftStart, setShiftStart] = useState('')
  const [shiftEnd, setShiftEnd] = useState('')
  const [days, setDays] = useState<Set<number>>(new Set(ALL_DAYS))
  const [category, setCategory] = useState('') // asset category
  const [division, setDivision] = useState('') // employee division
  const [shift, setShift] = useState('') // employee shift bucket (stored as category)

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next.size === 0 ? prev : next // require at least one day — use Deactivate for "never"
    })
  }

  // Assets: subgrouped by category. Employees: subgrouped by division, then shift.
  const assetGroups = useMemo(() => {
    const assets = resources.filter((r) => r.type === 'asset')
    const byCat = new Map<string, Resource[]>()
    for (const r of assets) {
      const cat = r.category || UNASSIGNED
      const list = byCat.get(cat)
      if (list) list.push(r)
      else byCat.set(cat, [r])
    }
    const order = [...ASSET_CATEGORIES, UNASSIGNED, ...[...byCat.keys()].filter((c) => !ASSET_CATEGORIES.includes(c as (typeof ASSET_CATEGORIES)[number]) && c !== UNASSIGNED)]
    return order.filter((cat) => byCat.has(cat)).map((cat) => ({ label: cat, items: byCat.get(cat)! }))
  }, [resources])

  const employeeGroups = useMemo(() => {
    const employees = resources.filter((r) => r.type === 'employee')
    const divisionOrder = [...EMPLOYEE_DIVISIONS, UNASSIGNED]
    return divisionOrder
      .map((div) => {
        const inDiv = employees.filter((r) => (r.division || UNASSIGNED) === div)
        const shiftOrder = [...EMPLOYEE_SHIFTS, UNASSIGNED]
        const shiftGroups = shiftOrder
          .map((sh) => ({ label: sh, items: inDiv.filter((r) => (r.category || UNASSIGNED) === sh) }))
          .filter((g) => g.items.length > 0)
        return { label: div, items: inDiv, shiftGroups }
      })
      .filter((g) => g.items.length > 0)
  }, [resources])

  function resetForm() {
    setName('')
    setKind('asset')
    setShiftStart('')
    setShiftEnd('')
    setDays(new Set(ALL_DAYS))
    setCategory('')
    setDivision('')
    setShift('')
  }

  function openAdd() {
    resetForm()
    setPanel({ mode: 'add' })
  }

  function openEdit(r: Resource) {
    if (!onUpdateResource) return
    setName(r.name)
    setKind(r.type)
    setShiftStart(r.shift_start == null ? '' : String(r.shift_start))
    setShiftEnd(r.shift_end == null ? '' : String(r.shift_end))
    setDays(r.available_days && r.available_days.length > 0 ? new Set(r.available_days) : new Set(ALL_DAYS))
    setCategory(r.type === 'asset' ? r.category ?? '' : '')
    setDivision(r.type === 'employee' ? r.division ?? '' : '')
    setShift(r.type === 'employee' ? r.category ?? '' : '')
    setPanel({ mode: 'edit', resourceId: r.id })
  }

  function closePanel() {
    setPanel({ mode: 'closed' })
  }

  function submit() {
    if (!name.trim()) return
    const common: NewResourceInput = {
      name: name.trim(),
      type: kind,
      shift_start: parseShiftHour(shiftStart),
      shift_end: parseShiftHour(shiftEnd),
      available_days: days.size >= 7 ? null : [...days].sort((a, b) => a - b),
      category: kind === 'asset' ? category || null : shift || null,
      division: kind === 'employee' ? division || null : null,
    }
    if (panel.mode === 'add' && onAddResource) {
      onAddResource(common)
    } else if (panel.mode === 'edit' && onUpdateResource) {
      onUpdateResource(panel.resourceId, common)
    }
    closePanel()
  }

  function deactivate() {
    if (panel.mode !== 'edit' || !onUpdateResource) return
    if (!confirm(`Deactivate ${name}? It won't be deleted — just hidden from the pool and pickers. Restore it directly in the database if needed.`)) {
      return
    }
    onUpdateResource(panel.resourceId, { active: false })
    closePanel()
  }

  const editing = panel.mode === 'edit'
  const showForm = panel.mode !== 'closed'

  function renderChip(r: Resource) {
    const status = resourceStatusNow(r, dateStr, now, tasks)
    const isEditingThis = panel.mode === 'edit' && panel.resourceId === r.id
    return (
      <button
        key={r.id}
        onClick={() => openEdit(r)}
        title={
          (onUpdateResource ? 'Click to edit · ' : '') +
          `${STATUS_LABEL[status]} · ${formatShiftWindow(r.shift_start, r.shift_end)} · ${formatAvailableDays(r.available_days)}`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 9px',
          borderRadius: '999px',
          border: `1px solid ${isEditingThis ? C.greenText : C.border}`,
          backgroundColor: isEditingThis ? '#1a2a1a' : C.panelAlt,
          fontSize: '12px',
          color: C.text,
          cursor: onUpdateResource ? 'pointer' : 'default',
        }}
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            backgroundColor: STATUS_COLOR[status],
            flexShrink: 0,
          }}
        />
        <span>{r.name}</span>
        <span style={{ fontSize: '10px', color: C.muted }}>
          {formatShiftWindow(r.shift_start, r.shift_end)}
          {r.available_days && r.available_days.length > 0 && r.available_days.length < 7 && (
            <> · {formatAvailableDays(r.available_days)}</>
          )}
        </span>
      </button>
    )
  }

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: '6px',
        backgroundColor: C.panel,
        fontFamily: C.serif,
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          Resource Pool
        </span>
        {onAddResource && (
          <button
            onClick={() => (showForm ? closePanel() : openAdd())}
            style={{
              background: 'none',
              border: `1px solid ${C.border}`,
              color: C.muted,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '3px 8px',
            }}
          >
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'grid', gap: '8px' }}>
          {editing && (
            <div style={{ fontSize: '11px', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Editing
            </div>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['asset', 'employee'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                style={{
                  flex: 1,
                  padding: '6px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  textTransform: 'capitalize',
                  border: `1px solid ${kind === k ? C.greenText : C.border}`,
                  background: kind === k ? '#1a2a1a' : 'transparent',
                  color: kind === k ? C.greenText : C.muted,
                }}
              >
                {k}
              </button>
            ))}
          </div>

          {kind === 'asset' ? (
            <div>
              <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>Category</div>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                <option value="">Uncategorized</option>
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>Division</div>
                <select value={division} onChange={(e) => setDivision(e.target.value)} style={inputStyle}>
                  <option value="">Unassigned</option>
                  {EMPLOYEE_DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>Shift</div>
                <select value={shift} onChange={(e) => setShift(e.target.value)} style={inputStyle}>
                  <option value="">Unassigned</option>
                  {EMPLOYEE_SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: C.muted }}>Shift hours</span>
            <input
              value={shiftStart}
              onChange={(e) => setShiftStart(e.target.value)}
              placeholder="start h"
              inputMode="numeric"
              style={{ ...inputStyle, width: '70px' }}
            />
            <span style={{ color: C.muted }}>–</span>
            <input
              value={shiftEnd}
              onChange={(e) => setShiftEnd(e.target.value)}
              placeholder="end h"
              inputMode="numeric"
              style={{ ...inputStyle, width: '70px' }}
            />
            <span style={{ fontSize: '10px', color: '#4a5a3a' }}>0–23, blank = any time</span>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>Days worked</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {DAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    border: `1px solid ${days.has(d) ? C.greenText : C.border}`,
                    background: days.has(d) ? '#1a2a1a' : 'transparent',
                    color: days.has(d) ? C.greenText : C.muted,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={submit} style={{ ...primaryBtn, flex: 1 }}>
              {editing ? 'Save changes' : 'Add resource'}
            </button>
            {editing && (
              <button onClick={deactivate} style={dangerBtn}>
                Deactivate
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: '8px 14px 14px' }}>
        {/* Assets, subgrouped by category */}
        <div style={{ marginTop: '8px' }}>
          <div style={subHeaderStyle}>Assets ({resources.filter((r) => r.type === 'asset').length})</div>
          {assetGroups.length === 0 && <span style={{ fontSize: '12px', color: '#3a4a2a' }}>None</span>}
          {assetGroups.map((g) => (
            <div key={g.label} style={{ marginTop: '6px', marginLeft: '4px' }}>
              <div style={subGroupHeaderStyle}>
                {g.label} ({g.items.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{g.items.map(renderChip)}</div>
            </div>
          ))}
        </div>

        {/* Employees, subgrouped by division then shift */}
        <div style={{ marginTop: '14px' }}>
          <div style={subHeaderStyle}>Employees ({resources.filter((r) => r.type === 'employee').length})</div>
          {employeeGroups.length === 0 && <span style={{ fontSize: '12px', color: '#3a4a2a' }}>None</span>}
          {employeeGroups.map((div) => (
            <div key={div.label} style={{ marginTop: '6px', marginLeft: '4px' }}>
              <div style={{ ...subGroupHeaderStyle, color: C.mutedBright }}>
                {div.label} ({div.items.length})
              </div>
              {div.shiftGroups.map((sg) => (
                <div key={sg.label} style={{ marginTop: '4px', marginLeft: '10px' }}>
                  <div style={{ ...subGroupHeaderStyle, fontSize: '9px' }}>
                    {sg.label} ({sg.items.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{sg.items.map(renderChip)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const subHeaderStyle: React.CSSProperties = {
  fontSize: '10px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: C.muted,
  margin: '4px 0 6px',
}

const subGroupHeaderStyle: React.CSSProperties = {
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#4a5a3a',
  margin: '2px 0 4px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  backgroundColor: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: '4px',
  fontSize: '13px',
  fontFamily: C.serif,
  boxSizing: 'border-box',
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 12px',
  backgroundColor: C.green,
  border: 'none',
  color: '#fff',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
}

const dangerBtn: React.CSSProperties = {
  padding: '7px 12px',
  backgroundColor: 'transparent',
  border: `1px solid ${C.danger}`,
  color: C.dangerText,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
}

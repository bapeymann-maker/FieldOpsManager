'use client'

import React, { useMemo, useState } from 'react'
import {
  DAY_LABELS,
  type Resource,
  type ResourceKind,
  type Task,
  formatAvailableDays,
  formatShiftWindow,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C, STATUS_COLOR } from './ui'

export type ResourcePatch = Partial<{
  name: string
  type: ResourceKind
  shift_start: number | null
  shift_end: number | null
  available_days: number[] | null
  active: boolean
}>

type Props = {
  resources: Resource[]
  tasks: Task[] // tasks for the currently viewed date
  dateStr: string
  now: Date
  onAddResource?: (input: {
    name: string
    type: ResourceKind
    shift_start: number | null
    shift_end: number | null
    available_days: number[] | null
  }) => void
  onUpdateResource?: (id: string, patch: ResourcePatch) => void
}

const ALL_DAYS = new Set([0, 1, 2, 3, 4, 5, 6])

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

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next.size === 0 ? prev : next // require at least one day — use Deactivate for "never"
    })
  }

  const groups = useMemo(() => {
    const assets = resources.filter((r) => r.type === 'asset')
    const employees = resources.filter((r) => r.type === 'employee')
    return [
      { label: 'Assets', items: assets },
      { label: 'Employees', items: employees },
    ]
  }, [resources])

  function openAdd() {
    setName('')
    setKind('asset')
    setShiftStart('')
    setShiftEnd('')
    setDays(new Set(ALL_DAYS))
    setPanel({ mode: 'add' })
  }

  function openEdit(r: Resource) {
    if (!onUpdateResource) return
    setName(r.name)
    setKind(r.type)
    setShiftStart(r.shift_start == null ? '' : String(r.shift_start))
    setShiftEnd(r.shift_end == null ? '' : String(r.shift_end))
    setDays(r.available_days && r.available_days.length > 0 ? new Set(r.available_days) : new Set(ALL_DAYS))
    setPanel({ mode: 'edit', resourceId: r.id })
  }

  function closePanel() {
    setPanel({ mode: 'closed' })
  }

  function submit() {
    if (!name.trim()) return
    const common = {
      name: name.trim(),
      type: kind,
      shift_start: shiftStart === '' ? null : Number(shiftStart),
      shift_end: shiftEnd === '' ? null : Number(shiftEnd),
      available_days: days.size >= 7 ? null : [...days].sort((a, b) => a - b),
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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: C.muted }}>Shift</span>
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
        {groups.map((g) => (
          <div key={g.label} style={{ marginTop: '8px' }}>
            <div
              style={{
                fontSize: '10px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#4a5a3a',
                margin: '4px 0 6px',
              }}
            >
              {g.label} ({g.items.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {g.items.length === 0 && (
                <span style={{ fontSize: '12px', color: '#3a4a2a' }}>None</span>
              )}
              {g.items.map((r) => {
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
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
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

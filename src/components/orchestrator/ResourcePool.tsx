'use client'

import React, { useMemo, useState } from 'react'
import {
  type Resource,
  type ResourceKind,
  type Task,
  formatShiftWindow,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C, STATUS_COLOR } from './ui'

export type ResourcePatch = Partial<{
  name: string
  type: ResourceKind
  shift_start: number | null
  shift_end: number | null
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
  }) => void
  onUpdateResource?: (id: string, patch: ResourcePatch) => void
}

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
    setPanel({ mode: 'add' })
  }

  function openEdit(r: Resource) {
    if (!onUpdateResource) return
    setName(r.name)
    setKind(r.type)
    setShiftStart(r.shift_start == null ? '' : String(r.shift_start))
    setShiftEnd(r.shift_end == null ? '' : String(r.shift_end))
    setPanel({ mode: 'edit', resourceId: r.id })
  }

  function closePanel() {
    setPanel({ mode: 'closed' })
  }

  function submit() {
    if (!name.trim()) return
    const patch: ResourcePatch = {
      name: name.trim(),
      type: kind,
      shift_start: shiftStart === '' ? null : Number(shiftStart),
      shift_end: shiftEnd === '' ? null : Number(shiftEnd),
    }
    if (panel.mode === 'add' && onAddResource) {
      onAddResource(patch as { name: string; type: ResourceKind; shift_start: number | null; shift_end: number | null })
    } else if (panel.mode === 'edit' && onUpdateResource) {
      onUpdateResource(panel.resourceId, patch)
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
                      onUpdateResource
                        ? `Click to edit · ${STATUS_LABEL[status]} · ${formatShiftWindow(r.shift_start, r.shift_end)}`
                        : `${STATUS_LABEL[status]} · ${formatShiftWindow(r.shift_start, r.shift_end)}`
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

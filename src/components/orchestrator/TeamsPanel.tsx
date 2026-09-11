'use client'

import React, { useMemo, useState } from 'react'
import type { DefaultGroup, Resource, TaskType } from '@/lib/orchestrator'
import { C } from './ui'

type GroupInput = {
  task_type_id: string
  name: string
  shift_start: number | null
  shift_end: number | null
}

type Props = {
  groups: DefaultGroup[]
  taskTypes: TaskType[]
  resources: Resource[]
  onCreate: (input: GroupInput, resourceIds: string[]) => void
  onUpdate: (id: string, patch: GroupInput, resourceIds: string[]) => void
  onDelete: (id: string) => void
}

type PanelState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; groupId: string }

export default function TeamsPanel({ groups, taskTypes, resources, onCreate, onUpdate, onDelete }: Props) {
  const [panel, setPanel] = useState<PanelState>({ mode: 'closed' })
  const [name, setName] = useState('')
  const [taskTypeId, setTaskTypeId] = useState('')
  const [shiftStart, setShiftStart] = useState('')
  const [shiftEnd, setShiftEnd] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const resourceById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources])
  const typeById = useMemo(() => new Map(taskTypes.map((t) => [t.id, t])), [taskTypes])
  const assets = useMemo(() => resources.filter((r) => r.type === 'asset'), [resources])
  const employees = useMemo(() => resources.filter((r) => r.type === 'employee'), [resources])

  function resetForm() {
    setName('')
    setTaskTypeId(taskTypes[0]?.id ?? '')
    setShiftStart('')
    setShiftEnd('')
    setPicked(new Set())
  }

  function openAdd() {
    resetForm()
    setPanel({ mode: 'add' })
  }

  function openEdit(g: DefaultGroup) {
    setName(g.name)
    setTaskTypeId(g.task_type_id)
    setShiftStart(g.shift_start == null ? '' : String(g.shift_start))
    setShiftEnd(g.shift_end == null ? '' : String(g.shift_end))
    setPicked(new Set(g.resource_ids))
    setPanel({ mode: 'edit', groupId: g.id })
  }

  function closePanel() {
    setPanel({ mode: 'closed' })
  }

  function toggleResource(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit() {
    if (!name.trim() || !taskTypeId) return
    const input: GroupInput = {
      name: name.trim(),
      task_type_id: taskTypeId,
      shift_start: shiftStart === '' ? null : Number(shiftStart),
      shift_end: shiftEnd === '' ? null : Number(shiftEnd),
    }
    const resourceIds = [...picked]
    if (panel.mode === 'add') onCreate(input, resourceIds)
    else if (panel.mode === 'edit') onUpdate(panel.groupId, input, resourceIds)
    closePanel()
  }

  function remove() {
    if (panel.mode !== 'edit') return
    if (!confirm(`Delete the "${name}" team? This only removes the saved selection — it never touches any task.`)) {
      return
    }
    onDelete(panel.groupId)
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
        <span style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.muted }}>
          Teams
        </span>
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
          {showForm ? 'Cancel' : '+ Add team'}
        </button>
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
            placeholder="Team name, e.g. Harvest_1_D"
            style={inputStyle}
          />
          <div>
            <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>Task type</div>
            <select value={taskTypeId} onChange={(e) => setTaskTypeId(e.target.value)} style={inputStyle}>
              {taskTypes.length === 0 && <option value="">No task types yet</option>}
              {taskTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: C.muted }}>Default shift</span>
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
            <span style={{ fontSize: '10px', color: '#4a5a3a' }}>blank = leave task time as-is</span>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: C.muted, marginBottom: '4px' }}>
              Members ({picked.size})
            </div>
            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'grid', gap: '4px' }}>
              {[
                { label: 'Assets', items: assets },
                { label: 'Employees', items: employees },
              ].map(
                (g) =>
                  g.items.length > 0 && (
                    <div key={g.label}>
                      <div style={{ fontSize: '9px', color: '#4a5a3a', textTransform: 'uppercase', margin: '4px 0 2px' }}>
                        {g.label}
                      </div>
                      {g.items.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => toggleResource(r.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '5px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            border: `1px solid ${picked.has(r.id) ? C.greenText : C.border}`,
                            background: picked.has(r.id) ? '#1a2a1a' : 'transparent',
                            color: C.text,
                            fontSize: '12px',
                          }}
                        >
                          <span
                            style={{
                              width: '13px',
                              height: '13px',
                              borderRadius: '3px',
                              border: `1px solid ${picked.has(r.id) ? C.greenText : C.border}`,
                              background: picked.has(r.id) ? C.greenText : 'transparent',
                              color: C.bg,
                              fontSize: '9px',
                              lineHeight: '11px',
                              textAlign: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {picked.has(r.id) ? '✓' : ''}
                          </span>
                          {r.name}
                          {(r.category || r.division) && (
                            <span style={{ color: C.muted, fontSize: '10px' }}>
                              {[r.division, r.category].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ),
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={submit} style={{ ...primaryBtn, flex: 1 }}>
              {editing ? 'Save changes' : 'Create team'}
            </button>
            {editing && (
              <button onClick={remove} style={dangerBtn}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: '8px 14px 14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {groups.length === 0 && <span style={{ fontSize: '12px', color: '#3a4a2a' }}>No teams yet</span>}
        {groups.map((g) => {
          const members = g.resource_ids.map((id) => resourceById.get(id)).filter((r): r is Resource => !!r)
          const isEditingThis = panel.mode === 'edit' && panel.groupId === g.id
          return (
            <button
              key={g.id}
              onClick={() => openEdit(g)}
              title="Click to edit"
              style={{
                textAlign: 'left',
                minWidth: '160px',
                maxWidth: '220px',
                padding: '8px 12px',
                borderRadius: '10px',
                border: `1px solid ${isEditingThis ? C.greenText : C.border}`,
                backgroundColor: isEditingThis ? '#1a2a1a' : C.panelAlt,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ fontSize: '13px', color: C.heading, fontWeight: 'bold' }}>{g.name}</span>
                <span style={{ fontSize: '9px', color: C.muted, whiteSpace: 'nowrap' }}>
                  {typeById.get(g.task_type_id)?.name ?? ''}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: C.muted, marginTop: '4px', lineHeight: 1.5 }}>
                {members.length === 0 ? (
                  <span style={{ color: '#3a4a2a' }}>No members yet</span>
                ) : (
                  members.map((m) => m.name).join(', ')
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
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

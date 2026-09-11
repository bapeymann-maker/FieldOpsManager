'use client'

import React, { useMemo, useState } from 'react'
import {
  FIELD_SECTIONS,
  type DefaultGroup,
  type FieldSection,
  type NewTaskInput,
  type OrchestratorField,
  type Resource,
  type Task,
  type TaskType,
  fieldsInSection,
  formatHour,
  formatShiftWindow,
  formatAvailableDays,
  isDayAvailable,
  isSameLocalDay,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C, STATUS_COLOR } from './ui'

type Props = {
  dateStr: string
  now: Date
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  defaultGroups: DefaultGroup[]
  tasksForDate: Task[]
  onClose: () => void
  onCreate: (input: NewTaskInput, resourceIds: string[]) => Promise<void>
  onAddField: (name: string, section: FieldSection) => Promise<OrchestratorField>
  onAddResource: (input: {
    name: string
    type: 'asset' | 'employee'
    shift_start: number | null
    shift_end: number | null
  }) => Promise<Resource>
}

const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => i / 2) // 0, 0.5 ... 24

export default function NewTaskModal({
  dateStr,
  now,
  taskTypes,
  fields,
  resources,
  defaultGroups,
  tasksForDate,
  onClose,
  onCreate,
  onAddField,
  onAddResource,
}: Props) {
  const [step, setStep] = useState(1)
  const [typeId, setTypeId] = useState('')
  const [section, setSection] = useState<FieldSection | ''>('')
  const [fieldId, setFieldId] = useState('')
  const [pickedResources, setPickedResources] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [taskDate, setTaskDate] = useState(dateStr)
  const [allDay, setAllDay] = useState(false)
  const [startHour, setStartHour] = useState(8)
  const [endHour, setEndHour] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [newFieldName, setNewFieldName] = useState('')
  const [newResName, setNewResName] = useState('')
  const [newResKind, setNewResKind] = useState<'asset' | 'employee'>('asset')

  const selectedType = taskTypes.find((t) => t.id === typeId)
  const selectedField = fields.find((f) => f.id === fieldId)
  const fieldsForSection = useMemo(
    () => (section ? fieldsInSection(fields, section) : []),
    [fields, section],
  )
  const groupsForType = useMemo(
    () => defaultGroups.filter((g) => g.task_type_id === typeId),
    [defaultGroups, typeId],
  )

  function toggleResource(id: string) {
    setPickedResources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyGroup(g: DefaultGroup) {
    setPickedResources(new Set(g.resource_ids))
    if (g.shift_start != null) setStartHour(g.shift_start)
    if (g.shift_end != null) setEndHour(g.shift_end < g.shift_start! ? g.shift_end + 24 : g.shift_end)
  }

  function goToDetails() {
    if (!title) {
      const parts = [selectedType?.name, selectedField?.name].filter(Boolean)
      setTitle(parts.join(' — ') || 'New task')
    }
    setStep(5)
  }

  function selectSection(s: FieldSection) {
    if (s !== section) setFieldId('') // clear a selection that no longer belongs to the shown list
    setSection(s)
    setStep(3)
  }

  async function handleCreateField() {
    if (!newFieldName.trim() || !section) return
    try {
      const f = await onAddField(newFieldName.trim(), section)
      setFieldId(f.id)
      setNewFieldName('')
    } catch (e) {
      setError(errText(e))
    }
  }

  async function handleCreateResource() {
    if (!newResName.trim()) return
    try {
      const r = await onAddResource({
        name: newResName.trim(),
        type: newResKind,
        shift_start: null,
        shift_end: null,
      })
      setPickedResources((prev) => new Set(prev).add(r.id))
      setNewResName('')
    } catch (e) {
      setError(errText(e))
    }
  }

  async function submit() {
    setError('')
    if (!typeId) return setError('Pick a task type.')
    if (!title.trim()) return setError('Give the task a name.')
    if (!allDay && endHour <= startHour) return setError('End time must be after start time.')
    setBusy(true)
    try {
      await onCreate(
        {
          title: title.trim(),
          task_type_id: typeId,
          field_id: fieldId || null,
          task_date: taskDate,
          start_hour: allDay ? 0 : startHour,
          end_hour: allDay ? 24 : endHour,
          all_day: allDay,
        },
        [...pickedResources],
      )
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '28px',
          width: '540px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: C.serif,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'normal', color: C.heading }}>New Task</h2>
          <span style={{ fontSize: '11px', color: C.muted }}>Step {step} of 5</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', margin: '10px 0 20px' }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '3px',
                borderRadius: '2px',
                backgroundColor: s <= step ? C.greenText : C.border,
              }}
            />
          ))}
        </div>

        {/* Step 1 — Type */}
        {step === 1 && (
          <div>
            <Label>Task type</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {taskTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTypeId(t.id)
                    setStep(2)
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    border: `1px solid ${typeId === t.id ? C.greenText : C.border}`,
                    background: typeId === t.id ? '#1a2a1a' : 'transparent',
                    color: typeId === t.id ? C.greenText : C.text,
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Section */}
        {step === 2 && (
          <div>
            <Label>Section</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {FIELD_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => selectSection(s.key)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    border: `1px solid ${section === s.key ? C.greenText : C.border}`,
                    background: section === s.key ? '#1a2a1a' : 'transparent',
                    color: section === s.key ? C.greenText : C.text,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={() => setStep(1)} onNext={() => section && setStep(3)} nextLabel="Next: field" />
            </div>
          </div>
        )}

        {/* Step 3 — Field */}
        {step === 3 && (
          <div>
            <Label>Field {section && <span style={{ textTransform: 'none', letterSpacing: 0 }}>— {FIELD_SECTIONS.find((s) => s.key === section)?.label}</span>}</Label>
            <select
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              style={{ ...inputStyle, marginBottom: '10px' }}
            >
              <option value="">No field / general</option>
              {fieldsForSection.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {fieldsForSection.length === 0 && (
              <div style={{ fontSize: '11px', color: C.muted, marginBottom: '10px' }}>
                No fields in this section yet — add one below.
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
              <input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="+ Add a field"
                style={inputStyle}
              />
              <button onClick={handleCreateField} style={ghostBtn}>
                Add
              </button>
            </div>
            <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Next: crew" />
          </div>
        )}

        {/* Step 4 — Crew */}
        {step === 4 && (
          <div>
            {groupsForType.length > 0 && (
              <>
                <Label>Saved crews</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {groupsForType.map((g) => {
                    const memberNames = g.resource_ids
                      .map((id) => resources.find((r) => r.id === id)?.name)
                      .filter(Boolean)
                      .join(', ')
                    return (
                      <button
                        key={g.id}
                        onClick={() => applyGroup(g)}
                        title={memberNames || 'No members yet'}
                        style={ghostBtn}
                      >
                        {g.name}
                        <span style={{ color: C.muted, marginLeft: '6px' }}>({g.resource_ids.length})</span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize: '10px', color: '#4a5a3a', marginTop: '-8px', marginBottom: '14px' }}>
                  Applying a team fills the crew below — add or remove individual resources afterward if needed.
                </div>
              </>
            )}
            <Label>Assign resources</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto' }}>
              {resources.map((r) => {
                const status = resourceStatusNow(r, taskDate, now, tasksForDate)
                const dayOff = !isDayAvailable(r, taskDate)
                const picked = pickedResources.has(r.id)
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleResource(r.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      border: `1px solid ${picked ? C.greenText : C.border}`,
                      background: picked ? '#1a2a1a' : 'transparent',
                      color: C.text,
                      fontSize: '13px',
                    }}
                  >
                    <span
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '3px',
                        border: `1px solid ${picked ? C.greenText : C.border}`,
                        background: picked ? C.greenText : 'transparent',
                        color: C.bg,
                        fontSize: '10px',
                        lineHeight: '12px',
                        textAlign: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {picked ? '✓' : ''}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ fontSize: '10px', color: C.muted, marginRight: '5px', textTransform: 'uppercase' }}>
                        {r.type === 'asset' ? 'A' : 'E'}
                      </span>
                      {r.name}
                      {(r.category || r.division) && (
                        <span style={{ color: C.mutedBright, fontSize: '11px', marginLeft: '6px' }}>
                          {[r.division, r.category].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span style={{ color: C.muted, fontSize: '11px', marginLeft: '6px' }}>
                        {formatShiftWindow(r.shift_start, r.shift_end)}
                        {r.available_days && r.available_days.length > 0 && r.available_days.length < 7 && (
                          <> · {formatAvailableDays(r.available_days)}</>
                        )}
                      </span>
                    </span>
                    {dayOff ? (
                      <span style={{ fontSize: '10px', color: STATUS_COLOR['off-shift'] }}>not scheduled</span>
                    ) : (
                      isSameLocalDay(now, taskDate) &&
                      status !== 'available' && (
                        <span style={{ fontSize: '10px', color: STATUS_COLOR[status] }}>{status}</span>
                      )
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px', margin: '12px 0 18px' }}>
              <select
                value={newResKind}
                onChange={(e) => setNewResKind(e.target.value as 'asset' | 'employee')}
                style={{ ...inputStyle, width: '110px' }}
              >
                <option value="asset">Asset</option>
                <option value="employee">Employee</option>
              </select>
              <input
                value={newResName}
                onChange={(e) => setNewResName(e.target.value)}
                placeholder="+ Add a resource"
                style={inputStyle}
              />
              <button onClick={handleCreateResource} style={ghostBtn}>
                Add
              </button>
            </div>
            <StepNav onBack={() => setStep(3)} onNext={goToDetails} nextLabel="Next: details" />
          </div>
        )}

        {/* Step 5 — Name & time */}
        {step === 5 && (
          <div>
            <Label>Task name</Label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '14px' }} />

            <Label>Date</Label>
            <input
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              style={{ ...inputStyle, marginBottom: '14px' }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', color: C.text }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>

            {!allDay && (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <Label>Start</Label>
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                    style={inputStyle}
                  >
                    {HOUR_OPTIONS.filter((h) => h < 24).map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <Label>End</Label>
                  <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} style={inputStyle}>
                    {HOUR_OPTIONS.filter((h) => h > startHour).map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                        {h >= 24 ? ' (+1d)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setStep(4)} style={ghostBtn}>
                Back
              </button>
              <button onClick={submit} disabled={busy} style={primaryBtn}>
                {busy ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </div>
        )}

        {error && step !== 5 && (
          <div style={{ color: '#ff6b6b', fontSize: '13px', marginTop: '12px' }}>{error}</div>
        )}

        <div style={{ marginTop: '18px', textAlign: 'right' }}>
          <button onClick={onClose} style={{ ...ghostBtn, borderColor: 'transparent' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: C.muted,
        marginBottom: '8px',
      }}
    >
      {children}
    </div>
  )
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void
  onNext: () => void
  nextLabel: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <button onClick={onBack} style={ghostBtn}>
        Back
      </button>
      <button onClick={onNext} style={primaryBtn}>
        {nextLabel}
      </button>
    </div>
  )
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong.'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  backgroundColor: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: '4px',
  fontSize: '14px',
  fontFamily: C.serif,
  boxSizing: 'border-box',
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px',
  backgroundColor: C.green,
  border: 'none',
  color: '#fff',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

const ghostBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: 'none',
  border: `1px solid ${C.border}`,
  color: C.muted,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

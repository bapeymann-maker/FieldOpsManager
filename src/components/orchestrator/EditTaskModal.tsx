'use client'

import React, { useMemo, useState } from 'react'
import {
  FIELD_SECTIONS,
  type FieldSection,
  type HaulDetails,
  type NewTaskInput,
  type OrchestratorField,
  type Resource,
  type ResourcePairing,
  type Task,
  type TaskType,
  equipmentCategoriesForTaskType,
  fieldSectionOf,
  fieldsInSection,
  formatHaulLocation,
  formatHour,
  groupAssetsByCategory,
  groupEmployeesByDivision,
  isDayAvailable,
  isSameLocalDay,
  pairedWith,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C } from './ui'
import { Label, ResourceOption, ghostBtn, inputStyle, primaryBtn } from './NewTaskModal'

type Props = {
  task: Task
  now: Date
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  pairings: ResourcePairing[]
  tasks: Task[] // all loaded tasks; filtered internally to the edited date
  onClose: () => void
  onSave: (taskId: string, patch: Partial<NewTaskInput>, resourceIds: string[]) => Promise<void>
  onDelete: (task: Task) => void
  onAddField: (name: string, section: FieldSection) => Promise<OrchestratorField>
  onAddResource: (input: {
    name: string
    type: 'asset' | 'employee'
    shift_start: number | null
    shift_end: number | null
    category?: string | null
  }) => Promise<Resource>
}

const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => i / 2) // 0, 0.5 ... 24

export default function EditTaskModal({
  task,
  now,
  taskTypes,
  fields,
  resources,
  pairings,
  tasks,
  onClose,
  onSave,
  onDelete,
  onAddField,
  onAddResource,
}: Props) {
  const taskType = taskTypes.find((t) => t.id === task.task_type_id)
  const isHauling = taskType?.name === 'Hauling'
  const haul = isHauling ? (task.details as HaulDetails | null) : null

  const initialField = fields.find((f) => f.id === task.field_id)

  const [title, setTitle] = useState(task.title)
  const [taskDate, setTaskDate] = useState(task.task_date)
  const [allDay, setAllDay] = useState(task.all_day)
  const [startHour, setStartHour] = useState(task.start_hour)
  const [endHour, setEndHour] = useState(task.end_hour)
  const [section, setSection] = useState<FieldSection | ''>(
    initialField ? (fieldSectionOf(initialField) ?? '') : '',
  )
  const [fieldId, setFieldId] = useState(task.field_id ?? '')
  const [pickedResources, setPickedResources] = useState<Set<string>>(new Set(task.resource_ids))
  const [newFieldName, setNewFieldName] = useState('')
  const [newResName, setNewResName] = useState('')
  const [newAssetCategory, setNewAssetCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fieldsForSection = useMemo(() => (section ? fieldsInSection(fields, section) : []), [fields, section])
  const equipmentCategories = equipmentCategoriesForTaskType(taskType?.name)
  const equipmentGroups = useMemo(
    () => groupAssetsByCategory(resources, equipmentCategories),
    [resources, equipmentCategories],
  )
  const crewGroups = useMemo(() => groupEmployeesByDivision(resources), [resources])
  const tasksOnDate = useMemo(() => tasks.filter((t) => t.task_date === taskDate), [tasks, taskDate])

  function toggleResource(id: string) {
    if (pickedResources.has(id)) {
      setPickedResources((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }
    const additions = [id]
    const resource = resources.find((r) => r.id === id)
    if (resource) {
      const partners = pairedWith(resource, pairings)
        .map((pid) => resources.find((r) => r.id === pid))
        .filter((r): r is Resource => !!r && !pickedResources.has(r.id))
      for (const partner of partners) {
        if (confirm(`${resource.name} is paired with ${partner.name}. Include ${partner.name} too?`)) {
          additions.push(partner.id)
        }
      }
    }
    setPickedResources((prev) => {
      const next = new Set(prev)
      for (const a of additions) next.add(a)
      return next
    })
  }

  function selectSection(s: FieldSection) {
    if (s !== section) setFieldId('')
    setSection(s)
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

  async function addResourceOfType(type: 'asset' | 'employee', category: string | null = null) {
    if (!newResName.trim()) return
    try {
      const r = await onAddResource({ name: newResName.trim(), type, shift_start: null, shift_end: null, category })
      setPickedResources((prev) => new Set(prev).add(r.id))
      setNewResName('')
    } catch (e) {
      setError(errText(e))
    }
  }

  async function handleSave() {
    setError('')
    if (!title.trim()) return setError('Give the task a name.')
    if (!allDay && endHour <= startHour) return setError('End time must be after start time.')
    setBusy(true)
    try {
      await onSave(
        task.id,
        {
          title: title.trim(),
          field_id: isHauling ? task.field_id : fieldId || null,
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

  function handleDelete() {
    if (!confirm(`Delete "${task.title}"?`)) return
    onDelete(task)
    onClose()
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
          width: '560px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: C.serif,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '18px' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'normal', color: C.heading }}>Edit Task</h2>
          <span style={{ fontSize: '11px', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {taskType?.name ?? 'Task'}
          </span>
        </div>

        <Label>Task name</Label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '14px' }} />

        {isHauling ? (
          <div
            style={{
              fontSize: '12px',
              color: C.mutedBright,
              backgroundColor: C.panelAlt,
              border: `1px solid ${C.border}`,
              borderRadius: '4px',
              padding: '10px 12px',
              marginBottom: '14px',
            }}
          >
            {haul ? (
              <>
                {haul.commodity} · {formatHaulLocation(haul.origin, fields)} → {formatHaulLocation(haul.destination, fields)}
              </>
            ) : (
              'No haul details on this task.'
            )}
            <div style={{ fontSize: '10px', color: C.muted, marginTop: '4px' }}>
              Origin/destination aren&apos;t editable here — delete and recreate the task to change them.
            </div>
          </div>
        ) : (
          <>
            <Label>Section</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              {FIELD_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => selectSection(s.key)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    border: `1px solid ${section === s.key ? C.greenText : C.border}`,
                    background: section === s.key ? '#1a2a1a' : 'transparent',
                    color: section === s.key ? C.greenText : C.text,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }}>
              <option value="">No field / general</option>
              {fieldsForSection.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
              <input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="+ Add a field"
                style={inputStyle}
              />
              <button onClick={handleCreateField} disabled={!section} style={ghostBtn}>
                Add
              </button>
            </div>
          </>
        )}

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
          <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
            <div style={{ flex: 1 }}>
              <Label>Start</Label>
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} style={inputStyle}>
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

        <Label>
          Equipment
          {equipmentCategories && (
            <span style={{ textTransform: 'none', letterSpacing: 0 }}> — {equipmentCategories.join(' / ')} only</span>
          )}
        </Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto', marginBottom: '10px' }}>
          {equipmentGroups.length === 0 && (
            <div style={{ fontSize: '12px', color: C.muted }}>
              {equipmentCategories ? `No ${equipmentCategories.join(' or ')} yet.` : 'No equipment yet.'}
            </div>
          )}
          {equipmentGroups.map((g) => (
            <div key={g.label}>
              <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '4px' }}>
                {g.label} ({g.items.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {g.items.map((r) => (
                  <ResourceOption
                    key={r.id}
                    r={r}
                    picked={pickedResources.has(r.id)}
                    onToggle={toggleResource}
                    status={resourceStatusNow(r, taskDate, now, tasksOnDate)}
                    dayOff={!isDayAvailable(r, taskDate)}
                    showStatus={isSameLocalDay(now, taskDate)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
          {equipmentCategories && (
            <select
              value={newAssetCategory || equipmentCategories[0]}
              onChange={(e) => setNewAssetCategory(e.target.value)}
              style={{ ...inputStyle, width: '110px' }}
            >
              {equipmentCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <input value={newResName} onChange={(e) => setNewResName(e.target.value)} placeholder="+ Add equipment" style={inputStyle} />
          <button
            onClick={() => addResourceOfType('asset', equipmentCategories ? newAssetCategory || equipmentCategories[0] : null)}
            style={ghostBtn}
          >
            Add
          </button>
        </div>

        <Label>Crew</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto', marginBottom: '10px' }}>
          {crewGroups.length === 0 && <div style={{ fontSize: '12px', color: C.muted }}>No employees yet.</div>}
          {crewGroups.map((g) => (
            <div key={g.label}>
              <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '4px' }}>
                {g.label} ({g.items.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {g.items.map((r) => (
                  <ResourceOption
                    key={r.id}
                    r={r}
                    picked={pickedResources.has(r.id)}
                    onToggle={toggleResource}
                    status={resourceStatusNow(r, taskDate, now, tasksOnDate)}
                    dayOff={!isDayAvailable(r, taskDate)}
                    showStatus={isSameLocalDay(now, taskDate)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
          <input value={newResName} onChange={(e) => setNewResName(e.target.value)} placeholder="+ Add an employee" style={inputStyle} />
          <button onClick={() => addResourceOfType('employee')} style={ghostBtn}>
            Add
          </button>
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={handleDelete} style={{ ...ghostBtn, borderColor: '#6b1a1a', color: '#ffaaaa' }}>
            Delete task
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={ghostBtn}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={busy} style={primaryBtn}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong.'
}

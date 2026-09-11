'use client'

import React, { useMemo } from 'react'
import {
  type OrchestratorField,
  type Resource,
  type Task,
  type TaskType,
  conflictedTaskIds,
  formatDateShort,
  formatHour,
  isSameLocalDay,
  scrubLineFraction,
  taskSpan,
  weekDays,
} from '@/lib/orchestrator'
import { C, taskTypeColor } from './ui'

type Props = {
  weekStart: string
  now: Date
  tasks: Task[] // tasks across the whole week
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  onSelectDate: (dateStr: string) => void
  onSelectTask?: (task: Task) => void
}

const RES_COL = 170

export default function WeekGrid({
  weekStart,
  now,
  tasks,
  taskTypes,
  fields,
  resources,
  onSelectDate,
  onSelectTask,
}: Props) {
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const conflicts = useMemo(() => conflictedTaskIds(tasks), [tasks])
  const typeById = useMemo(() => new Map(taskTypes.map((t) => [t.id, t])), [taskTypes])
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields])

  // resourceId -> dateStr -> tasks
  const grid = useMemo(() => {
    const m = new Map<string, Map<string, Task[]>>()
    for (const r of resources) m.set(r.id, new Map())
    for (const t of tasks) {
      for (const rid of t.resource_ids) {
        const byDate = m.get(rid)
        if (!byDate) continue
        const list = byDate.get(t.task_date)
        if (list) list.push(t)
        else byDate.set(t.task_date, [t])
      }
    }
    return m
  }, [tasks, resources])

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: '6px', overflow: 'auto', backgroundColor: C.panel }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '720px', fontFamily: C.serif }}>
        <thead>
          <tr>
            <th
              style={{
                ...headCell,
                width: RES_COL,
                position: 'sticky',
                left: 0,
                backgroundColor: C.panel,
                textAlign: 'left',
              }}
            >
              Resource
            </th>
            {days.map((d) => (
              <th
                key={d}
                onClick={() => onSelectDate(d)}
                style={{
                  ...headCell,
                  cursor: 'pointer',
                  color: isSameLocalDay(now, d) ? C.heading : C.muted,
                }}
              >
                {formatDateShort(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((r, i) => (
            <tr key={r.id} style={{ backgroundColor: i % 2 ? C.bg : C.panel }}>
              <td
                style={{
                  ...bodyCell,
                  position: 'sticky',
                  left: 0,
                  backgroundColor: i % 2 ? C.bg : C.panel,
                  color: C.text,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: '10px', color: C.muted, marginRight: '5px', textTransform: 'uppercase' }}>
                  {r.type === 'asset' ? 'A' : 'E'}
                </span>
                {r.name}
              </td>
              {days.map((d) => {
                const dayTasks = (grid.get(r.id)?.get(d) ?? []).slice().sort((a, b) => a.start_hour - b.start_hour)
                const isToday = isSameLocalDay(now, d)
                return (
                  <td key={d} style={{ ...bodyCell, position: 'relative', verticalAlign: 'top', minWidth: '96px' }}>
                    {isToday && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${scrubLineFraction(now) * 100}%`,
                          top: 0,
                          bottom: 0,
                          width: '2px',
                          backgroundColor: '#c85a5a',
                          opacity: 0.5,
                        }}
                      />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', position: 'relative' }}>
                      {dayTasks.map((t) => {
                        const [s, e] = taskSpan(t)
                        const type = typeById.get(t.task_type_id)
                        const field = t.field_id ? fieldById.get(t.field_id) : undefined
                        return (
                          <button
                            key={t.id}
                            onClick={() => onSelectTask?.(t)}
                            title={`${t.title} · ${t.all_day ? 'All day' : `${formatHour(s)}–${formatHour(e)}`}`}
                            style={{
                              textAlign: 'left',
                              border: `1px solid ${conflicts.has(t.id) ? '#ff6b6b' : taskTypeColor(type?.name)}`,
                              background: taskTypeColor(type?.name) + (t.completed ? '22' : '44'),
                              color: C.text,
                              borderRadius: '3px',
                              padding: '2px 5px',
                              fontSize: '10px',
                              cursor: 'pointer',
                              opacity: t.completed ? 0.5 : 1,
                              textDecoration: t.completed ? 'line-through' : 'none',
                            }}
                          >
                            {field?.name ?? type?.name ?? t.title}
                            <span style={{ color: C.muted }}>
                              {' '}
                              {t.all_day ? '·' : formatHour(s)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
          {resources.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...bodyCell, textAlign: 'center', color: C.muted }}>
                No resources yet — sync from John Deere or add one manually.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const headCell: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  borderBottom: `1px solid ${C.border}`,
  color: C.muted,
  textAlign: 'center',
}

const bodyCell: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '12px',
  borderBottom: `1px solid ${C.borderLight}`,
  borderRight: `1px solid ${C.borderLight}`,
}

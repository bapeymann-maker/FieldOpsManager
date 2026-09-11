'use client'

import React, { useMemo } from 'react'
import {
  type OrchestratorField,
  type Resource,
  type Task,
  type TaskType,
  conflictedTaskIds,
  formatHour,
  isSameLocalDay,
  scrubLineFraction,
} from '@/lib/orchestrator'
import { C } from './ui'
import TaskRow from './TaskRow'

type Props = {
  dateStr: string
  now: Date
  tasks: Task[]
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  onToggleComplete: (task: Task) => void
  onDelete: (task: Task) => void
  onSelect?: (task: Task) => void
}

const LABEL_WIDTH = 240
const HOURS = Array.from({ length: 25 }, (_, i) => i)

export default function DayTimeline({
  dateStr,
  now,
  tasks,
  taskTypes,
  fields,
  resources,
  onToggleComplete,
  onDelete,
  onSelect,
}: Props) {
  const conflicts = useMemo(() => conflictedTaskIds(tasks), [tasks])
  const typeById = useMemo(() => new Map(taskTypes.map((t) => [t.id, t])), [taskTypes])
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields])

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        return a.start_hour - b.start_hour
      }),
    [tasks],
  )

  const showScrub = isSameLocalDay(now, dateStr)
  const scrubPct = scrubLineFraction(now) * 100

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: '6px', overflow: 'hidden', backgroundColor: C.panel }}>
      {/* Hour ruler */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        <div
          style={{
            width: LABEL_WIDTH,
            flexShrink: 0,
            padding: '6px 10px',
            borderRight: `1px solid ${C.border}`,
            fontSize: '11px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          Tasks
        </div>
        <div style={{ position: 'relative', flex: 1, height: '26px' }}>
          {HOURS.filter((h) => h % 3 === 0 && h < 24).map((h) => (
            <span
              key={h}
              style={{
                position: 'absolute',
                left: `${(h / 24) * 100}%`,
                top: '6px',
                fontSize: '10px',
                color: C.muted,
                transform: 'translateX(-50%)',
              }}
            >
              {formatHour(h)}
            </span>
          ))}
        </div>
      </div>

      {/* Rows + scrub overlay */}
      <div style={{ position: 'relative' }}>
        {/* vertical hour gridlines over the track area only */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            left: LABEL_WIDTH,
            pointerEvents: 'none',
          }}
        >
          {HOURS.map((h) => (
            <div
              key={h}
              style={{
                position: 'absolute',
                left: `${(h / 24) * 100}%`,
                top: 0,
                bottom: 0,
                width: '1px',
                backgroundColor: h % 6 === 0 ? C.border : C.borderLight,
              }}
            />
          ))}
          {showScrub && (
            <div
              style={{
                position: 'absolute',
                left: `${scrubPct}%`,
                top: 0,
                bottom: 0,
                width: '2px',
                backgroundColor: '#c85a5a',
              }}
            />
          )}
        </div>

        {sorted.length === 0 && (
          <div style={{ padding: '28px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
            No tasks scheduled for this day.
          </div>
        )}

        {sorted.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            taskType={typeById.get(task.task_type_id)}
            field={task.field_id ? fieldById.get(task.field_id) : undefined}
            resources={resources}
            conflicted={conflicts.has(task.id)}
            labelWidth={LABEL_WIDTH}
            onToggleComplete={onToggleComplete}
            onDelete={onDelete}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

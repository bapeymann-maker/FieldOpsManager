'use client'

import React from 'react'
import {
  type OrchestratorField,
  type Resource,
  type Task,
  type TaskType,
  formatHour,
  isOutsideAvailability,
  taskSpan,
} from '@/lib/orchestrator'
import { C, taskTypeColor } from './ui'

type Props = {
  task: Task
  taskType?: TaskType
  field?: OrchestratorField
  resources: Resource[] // full pool, for name/shift lookup
  conflicted: boolean
  labelWidth: number
  trackWidth: number
  onToggleComplete: (task: Task) => void
  onDelete: (task: Task) => void
  onSelect?: (task: Task) => void
}

export default function TaskRow({
  task,
  taskType,
  field,
  resources,
  conflicted,
  labelWidth,
  trackWidth,
  onToggleComplete,
  onDelete,
  onSelect,
}: Props) {
  const [start, end] = taskSpan(task)
  const leftPct = (Math.min(start, 24) / 24) * 100
  const widthPct = (Math.max(0, Math.min(end, 24) - Math.min(start, 24)) / 24) * 100
  const color = taskTypeColor(taskType?.name)

  const assigned = task.resource_ids
    .map((id) => resources.find((r) => r.id === id))
    .filter((r): r is Resource => !!r)
  const outside = assigned.filter((r) => isOutsideAvailability(r, task))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `1px solid ${C.borderLight}`,
        opacity: task.completed ? 0.5 : 1,
      }}
    >
      {/* Label cell — sticky so it stays put while the hour track scrolls */}
      <div
        style={{
          width: labelWidth,
          flexShrink: 0,
          position: 'sticky',
          left: 0,
          zIndex: 1,
          backgroundColor: C.panel,
          padding: '8px 10px',
          borderRight: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          cursor: onSelect ? 'pointer' : 'default',
        }}
        onClick={() => onSelect?.(task)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleComplete(task)
            }}
            title={task.completed ? 'Mark incomplete' : 'Mark complete'}
            style={{
              width: '15px',
              height: '15px',
              flexShrink: 0,
              borderRadius: '3px',
              border: `1px solid ${task.completed ? C.greenText : C.border}`,
              background: task.completed ? C.greenText : 'transparent',
              color: C.bg,
              fontSize: '11px',
              lineHeight: '13px',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {task.completed ? '✓' : ''}
          </button>
          <span
            title={onSelect ? 'Click to edit' : undefined}
            style={{
              fontSize: '13px',
              color: C.text,
              textDecoration: task.completed ? 'line-through' : 'none',
              borderBottom: onSelect ? '1px dotted #4a5a3a' : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {task.title}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: C.muted, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ color }}>{taskType?.name ?? 'Task'}</span>
          {field && <span>· {field.name}</span>}
          <span>· {task.all_day ? 'All day' : `${formatHour(start)}–${formatHour(end)}`}</span>
        </div>
        {(conflicted || outside.length > 0) && (
          <div style={{ fontSize: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {conflicted && <span style={{ color: '#ff6b6b' }}>⚠ double-booked</span>}
            {outside.length > 0 && (
              <span style={{ color: C.amberText }}>
                ⚠ {outside.map((r) => r.name).join(', ')} off-shift
              </span>
            )}
          </div>
        )}
        {/* Full resource list — the row is tall enough now to spell these out
            instead of relying on the bar's single truncated line. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
          {assigned.length === 0 && <span style={{ fontSize: '10px', color: '#3a4a2a' }}>No resources assigned</span>}
          {assigned.map((r) => (
            <span
              key={r.id}
              style={{
                fontSize: '10px',
                padding: '1px 7px',
                borderRadius: '999px',
                border: `1px solid ${C.border}`,
                backgroundColor: C.panelAlt,
                color: C.text,
                whiteSpace: 'nowrap',
              }}
            >
              {r.name}
            </span>
          ))}
        </div>
      </div>

      {/* Bar track — fixed width matching the hour ruler above, not flex:1,
          so percentage-based bar positions line up with the scrolled ruler.
          Row height is 3x the old baseline so the label cell has room for
          the full resource list above. */}
      <div style={{ position: 'relative', width: trackWidth, flexShrink: 0, minHeight: '132px' }}>
        <div
          style={{
            position: 'absolute',
            top: '8px',
            bottom: '8px',
            left: `${leftPct}%`,
            width: `${Math.max(widthPct, 1.5)}%`,
            borderRadius: '4px',
            backgroundColor: task.completed ? '#2a3020' : color + '55',
            border: `1px solid ${conflicted ? '#ff6b6b' : color}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 6px',
            overflow: 'hidden',
          }}
        >
          <span style={{ fontSize: '10px', color: C.text, whiteSpace: 'nowrap' }}>
            {assigned.map((r) => r.name).join(', ') || '—'}
          </span>
        </div>
        <button
          onClick={() => onDelete(task)}
          title="Delete task"
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: 'none',
            border: 'none',
            color: C.muted,
            cursor: 'pointer',
            fontSize: '13px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

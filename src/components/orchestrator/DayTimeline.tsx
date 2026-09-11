'use client'

import React, { useEffect, useMemo, useRef } from 'react'
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
// Fixed px-per-hour (rather than stretching 24h to the viewport width) so the
// grid is wide enough to scroll through and individual hours stay readable.
const HOUR_WIDTH = 70
const TRACK_WIDTH = 24 * HOUR_WIDTH
const HOURS = Array.from({ length: 25 }, (_, i) => i)
const DEFAULT_HOUR = 6 // where to land when the viewed day isn't "today"

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
  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        return a.start_hour - b.start_hour
      }),
    [tasks],
  )

  const showScrub = isSameLocalDay(now, dateStr)
  const scrubLeft = scrubLineFraction(now) * TRACK_WIDTH

  // Land the view near the current hour (today) or a sensible work-start
  // hour (other days) instead of always opening at midnight.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const targetHour = showScrub ? now.getHours() + now.getMinutes() / 60 : DEFAULT_HOUR
    el.scrollLeft = Math.max(0, targetHour * HOUR_WIDTH - el.clientWidth / 3)
    // Only re-center when the viewed date changes, not on every "now" tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr])

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: '6px', overflow: 'hidden', backgroundColor: C.panel }}>
      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LABEL_WIDTH + TRACK_WIDTH }}>
          {/* Hour ruler */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
            <div
              style={{
                width: LABEL_WIDTH,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 2,
                backgroundColor: C.panel,
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
            <div style={{ position: 'relative', width: TRACK_WIDTH, flexShrink: 0, height: '26px' }}>
              {HOURS.filter((h) => h < 24).map((h) => (
                <span
                  key={h}
                  style={{
                    position: 'absolute',
                    left: `${h * HOUR_WIDTH}px`,
                    top: '6px',
                    fontSize: '10px',
                    color: C.muted,
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
                left: LABEL_WIDTH,
                top: 0,
                bottom: 0,
                width: TRACK_WIDTH,
                pointerEvents: 'none',
              }}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{
                    position: 'absolute',
                    left: `${h * HOUR_WIDTH}px`,
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
                    left: `${scrubLeft}px`,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    backgroundColor: '#c85a5a',
                  }}
                />
              )}
            </div>

            {sorted.length === 0 && (
              <div style={{ padding: '28px', textAlign: 'center', color: C.muted, fontSize: '13px', width: LABEL_WIDTH + TRACK_WIDTH }}>
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
                trackWidth={TRACK_WIDTH}
                onToggleComplete={onToggleComplete}
                onDelete={onDelete}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

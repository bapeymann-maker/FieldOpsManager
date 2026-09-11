'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  type OrchestratorField,
  type Resource,
  type Task,
  type TaskType,
  addDays,
  conflictedTaskIds,
  formatDateShort,
  formatHour,
  scrubLineFraction,
  toDateStr,
} from '@/lib/orchestrator'
import { C } from './ui'
import TaskRow from './TaskRow'

export type DayCursor = { dateStr: string; hour: number }

type Props = {
  dateStr: string // the centered/selected day; window spans 2 days before/after it
  now: Date
  tasks: Task[] // tasks across the whole window (caller filters by window dates)
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  onToggleComplete: (task: Task) => void
  onDelete: (task: Task) => void
  onSelect?: (task: Task) => void
  /** Fires as the view scrolls — the (day, hour) currently under the green cursor line. */
  onCursorChange?: (cursor: DayCursor) => void
}

const LABEL_WIDTH = 240
const HOUR_WIDTH = 70
const DAY_WIDTH = 24 * HOUR_WIDTH
const WINDOW_RADIUS = 2 // days before/after the selected day
const WINDOW_DAYS = WINDOW_RADIUS * 2 + 1
const TRACK_WIDTH = WINDOW_DAYS * DAY_WIDTH
const HOURS = Array.from({ length: 25 }, (_, i) => i)
const DEFAULT_HOUR = 6 // where to land when the selected day isn't "today"
// Fixed viewport offset (from the scroll container's left edge) where the
// stationary green cursor line is drawn — comfortably clear of the sticky
// label column.
const CURSOR_VIEWPORT_X = LABEL_WIDTH + 120

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
  onCursorChange,
}: Props) {
  const typeById = useMemo(() => new Map(taskTypes.map((t) => [t.id, t])), [taskTypes])
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<DayCursor | null>(null)

  const windowDates = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(dateStr, i - WINDOW_RADIUS)),
    [dateStr],
  )
  const dayIndex = useMemo(() => new Map(windowDates.map((d, i) => [d, i])), [windowDates])

  const sorted = useMemo(
    () =>
      tasks
        .filter((t) => dayIndex.has(t.task_date))
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1
          if (a.task_date !== b.task_date) return a.task_date < b.task_date ? -1 : 1
          return a.start_hour - b.start_hour
        }),
    [tasks, dayIndex],
  )

  const conflicts = useMemo(() => conflictedTaskIds(tasks), [tasks])

  const todayIdx = dayIndex.get(toDateStr(now))
  const showRedLine = todayIdx != null
  const redLeft = showRedLine ? todayIdx! * DAY_WIDTH + scrubLineFraction(now) * DAY_WIDTH : 0

  // Land the view on the selected day, near the current hour (today) or a
  // sensible work-start hour (other days), instead of always opening at the
  // very start of the 5-day window.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const targetHour = windowDates[WINDOW_RADIUS] === toDateStr(now) ? now.getHours() + now.getMinutes() / 60 : DEFAULT_HOUR
    el.scrollLeft = Math.max(0, WINDOW_RADIUS * DAY_WIDTH + targetHour * HOUR_WIDTH - el.clientWidth / 3)
    // Only re-center when the window changes, not on every "now" tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr])

  // Track scroll position -> which (day, hour) sits under the stationary
  // green cursor line, for the Resource Pool's live status. Runs after the
  // auto-scroll effect above (declared later => same-render effects run in
  // order), so the initial read sees the landed scroll position.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf: number | null = null
    function update() {
      raf = null
      const trackX = Math.max(0, CURSOR_VIEWPORT_X + el!.scrollLeft - LABEL_WIDTH)
      const totalHour = Math.min(trackX / HOUR_WIDTH, WINDOW_DAYS * 24 - 0.01)
      const idx = Math.min(WINDOW_DAYS - 1, Math.floor(totalHour / 24))
      const next = { dateStr: windowDates[idx], hour: totalHour - idx * 24 }
      setCursor(next)
      onCursorChange?.(next)
    }
    function onScroll() {
      if (raf == null) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf != null) cancelAnimationFrame(raf)
    }
    // Deliberately excludes onCursorChange (keep the listener stable) — pass
    // a stable callback (e.g. a useState setter) from the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDates])

  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${C.border}`,
        borderRadius: '6px',
        overflow: 'hidden',
        backgroundColor: C.panel,
      }}
    >
      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LABEL_WIDTH + TRACK_WIDTH }}>
          {/* Day + hour ruler */}
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
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              Tasks
            </div>
            <div style={{ position: 'relative', width: TRACK_WIDTH, flexShrink: 0 }}>
              {/* day labels */}
              <div style={{ display: 'flex', height: '20px', borderBottom: `1px solid ${C.borderLight}` }}>
                {windowDates.map((d) => (
                  <div
                    key={d}
                    style={{
                      width: DAY_WIDTH,
                      flexShrink: 0,
                      fontSize: '11px',
                      color: d === dateStr ? C.heading : d === toDateStr(now) ? C.greenText : C.muted,
                      paddingLeft: '4px',
                    }}
                  >
                    {formatDateShort(d)}
                    {d === toDateStr(now) ? ' · today' : ''}
                  </div>
                ))}
              </div>
              {/* hour ticks */}
              <div style={{ position: 'relative', height: '20px' }}>
                {windowDates.map((d, di) =>
                  HOURS.filter((h) => h % 3 === 0 && h < 24).map((h) => (
                    <span
                      key={`${d}-${h}`}
                      style={{
                        position: 'absolute',
                        left: `${di * DAY_WIDTH + h * HOUR_WIDTH}px`,
                        top: '4px',
                        fontSize: '10px',
                        color: C.muted,
                      }}
                    >
                      {formatHour(h)}
                    </span>
                  )),
                )}
              </div>
            </div>
          </div>

          {/* Rows + gridline/scrub overlay */}
          <div style={{ position: 'relative' }}>
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
              {windowDates.map((d, di) =>
                HOURS.map((h) => (
                  <div
                    key={`${d}-${h}`}
                    style={{
                      position: 'absolute',
                      left: `${di * DAY_WIDTH + h * HOUR_WIDTH}px`,
                      top: 0,
                      bottom: 0,
                      width: '1px',
                      backgroundColor: h % 6 === 0 ? C.border : C.borderLight,
                    }}
                  />
                )),
              )}
              {showRedLine && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${redLeft}px`,
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
                No tasks scheduled in this window.
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
                hourWidth={HOUR_WIDTH}
                dayOffsetPx={(dayIndex.get(task.task_date) ?? WINDOW_RADIUS) * DAY_WIDTH}
                showDate
                onToggleComplete={onToggleComplete}
                onDelete={onDelete}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Stationary green cursor line — fixed in the viewport (outside the
          scrolling content) so it stays put while the timeline scrolls
          underneath it; the Resource Pool reflects availability at whatever
          (day, hour) it's currently pointing to. */}
      <div
        style={{
          position: 'absolute',
          left: `${CURSOR_VIEWPORT_X}px`,
          top: 0,
          bottom: 0,
          width: '2px',
          backgroundColor: '#4aaa4a',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
      {cursor && (
        <div
          style={{
            position: 'absolute',
            left: `${CURSOR_VIEWPORT_X + 6}px`,
            top: '2px',
            fontSize: '10px',
            color: C.greenText,
            backgroundColor: C.panel,
            padding: '1px 6px',
            borderRadius: '3px',
            border: `1px solid ${C.greenText}`,
            pointerEvents: 'none',
            zIndex: 3,
            whiteSpace: 'nowrap',
          }}
        >
          {formatDateShort(cursor.dateStr)} {formatHour(cursor.hour)}
        </div>
      )}
    </div>
  )
}

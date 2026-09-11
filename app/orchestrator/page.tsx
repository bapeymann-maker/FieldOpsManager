'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  type FieldSection,
  type NewTaskInput,
  type OrchestratorField,
  type Resource,
  type Task,
  addDays,
  formatDateLong,
  startOfWeek,
  toDateStr,
  weekDays,
} from '@/lib/orchestrator'
import {
  type Lookups,
  type OrchestratorRole,
  addManualField,
  addManualResource,
  createDefaultGroup,
  createTask,
  deleteDefaultGroup,
  deleteTask,
  fetchLookups,
  fetchMyRole,
  fetchTasks,
  orchestratorClient,
  setTaskCompleted,
  setTaskResources,
  subscribeToTasks,
  updateDefaultGroup,
  updateResource,
  updateTask,
} from '@/lib/orchestrator-data'
import type { ResourcePatch } from '@/components/orchestrator/ResourcePool'
import DayTimeline from '@/components/orchestrator/DayTimeline'
import WeekGrid from '@/components/orchestrator/WeekGrid'
import ResourcePool from '@/components/orchestrator/ResourcePool'
import TeamsPanel from '@/components/orchestrator/TeamsPanel'
import NewTaskModal from '@/components/orchestrator/NewTaskModal'
import EditTaskModal from '@/components/orchestrator/EditTaskModal'
import { C } from '@/components/orchestrator/ui'

type View = 'day' | 'week'

export default function OrchestratorPage() {
  const router = useRouter()

  const [currentDate, setCurrentDate] = useState(() => toDateStr(new Date()))
  const [currentView, setCurrentView] = useState<View>('day')
  const [now, setNow] = useState(() => new Date())

  const [role, setRole] = useState<OrchestratorRole | null | undefined>(undefined)
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  // Tick the scrub line / "now"-based status every 30s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const visibleDates = useMemo(
    () => (currentView === 'day' ? [currentDate] : weekDays(startOfWeek(currentDate))),
    [currentView, currentDate],
  )
  const visibleKey = visibleDates.join(',')

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await fetchTasks(visibleDates))
    } catch (e) {
      setError(msg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  // Access check + one-time lookups.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchMyRole()
      if (cancelled) return
      setRole(r)
      if (!r) {
        setLoading(false)
        return
      }
      try {
        setLookups(await fetchLookups())
      } catch (e) {
        setError(msg(e))
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Tasks for the visible range; refetch when it changes.
  useEffect(() => {
    if (!role) return
    loadTasks()
  }, [role, loadTasks])

  // Live updates (best effort). Debounced refetch.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!role) return
    const unsub = subscribeToTasks(() => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(loadTasks, 400)
    })
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      unsub()
    }
  }, [role, loadTasks])

  const assetIds = useMemo(
    () => new Set((lookups?.resources ?? []).filter((r) => r.type === 'asset').map((r) => r.id)),
    [lookups],
  )

  async function handleToggleComplete(task: Task) {
    const assetsOnTask = task.resource_ids.filter((id) => assetIds.has(id))
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              completed: !t.completed,
              resource_ids: !t.completed
                ? t.resource_ids.filter((id) => !assetIds.has(id))
                : t.resource_ids,
            }
          : t,
      ),
    )
    try {
      await setTaskCompleted(task.id, !task.completed, assetsOnTask)
    } catch (e) {
      setError(msg(e))
      loadTasks()
    }
  }

  async function handleDelete(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await deleteTask(task.id)
    } catch (e) {
      setError(msg(e))
      loadTasks()
    }
  }

  async function handleCreate(input: NewTaskInput, resourceIds: string[]) {
    await createTask(input, resourceIds)
    await loadTasks()
  }

  async function handleSaveTask(taskId: string, patch: Partial<NewTaskInput>, resourceIds: string[]) {
    await updateTask(taskId, patch)
    await setTaskResources(taskId, resourceIds)
    await loadTasks()
  }

  async function handleUpdateResource(id: string, patch: ResourcePatch): Promise<void> {
    await updateResource(id, patch)
    setLookups((prev) => {
      if (!prev) return prev
      // fetchLookups only returns active resources, so a deactivation drops
      // the row from local state the same way a refetch would.
      if (patch.active === false) {
        return { ...prev, resources: prev.resources.filter((r) => r.id !== id) }
      }
      return { ...prev, resources: prev.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
    })
  }

  async function handleAddField(name: string, section: FieldSection): Promise<OrchestratorField> {
    const f = await addManualField(name, section)
    setLookups((prev) => (prev ? { ...prev, fields: [...prev.fields, f].sort((a, b) => a.name.localeCompare(b.name)) } : prev))
    return f
  }

  async function handleAddResource(input: {
    name: string
    type: 'asset' | 'employee'
    shift_start: number | null
    shift_end: number | null
    available_days?: number[] | null
    category?: string | null
    division?: string | null
  }): Promise<Resource> {
    const r = await addManualResource(input)
    setLookups((prev) => (prev ? { ...prev, resources: [...prev.resources, r] } : prev))
    return r
  }

  // Teams change rarely and their membership is nested (default_group_resources),
  // so a full lookups refetch is simpler and cheap here vs. patching local state.
  async function refreshLookups() {
    try {
      setLookups(await fetchLookups())
    } catch (e) {
      setError(msg(e))
    }
  }

  async function handleCreateGroup(
    input: { task_type_id: string; name: string; shift_start: number | null; shift_end: number | null },
    resourceIds: string[],
  ) {
    await createDefaultGroup(input, resourceIds)
    await refreshLookups()
  }

  async function handleUpdateGroup(
    id: string,
    patch: { task_type_id: string; name: string; shift_start: number | null; shift_end: number | null },
    resourceIds: string[],
  ) {
    await updateDefaultGroup(id, patch, resourceIds)
    await refreshLookups()
  }

  async function handleDeleteGroup(id: string) {
    await deleteDefaultGroup(id)
    await refreshLookups()
  }

  async function signOut() {
    await orchestratorClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const tasksForCurrentDate = useMemo(
    () => tasks.filter((t) => t.task_date === currentDate),
    [tasks, currentDate],
  )

  // ── Render ───────────────────────────────────────────────────────────────

  if (role === null) {
    return (
      <Shell onBack={() => router.push('/')}>
        <div style={{ padding: '40px', textAlign: 'center', color: C.muted }}>
          <p style={{ fontSize: '15px', color: C.heading }}>No orchestrator access</p>
          <p style={{ fontSize: '13px' }}>
            Your login isn&apos;t assigned an owner / admin / manager role for the Task Orchestrator.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell onBack={() => router.push('/')}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: '4px', overflow: 'hidden' }}>
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setCurrentView(v)}
              style={{
                padding: '6px 14px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                textTransform: 'capitalize',
                backgroundColor: currentView === v ? C.border : 'transparent',
                color: currentView === v ? C.heading : C.muted,
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <NavBtn onClick={() => setCurrentDate((d) => addDays(d, currentView === 'week' ? -7 : -1))}>‹</NavBtn>
          <button
            onClick={() => setCurrentDate(toDateStr(new Date()))}
            style={{ ...navBtnStyle, padding: '6px 12px' }}
          >
            Today
          </button>
          <NavBtn onClick={() => setCurrentDate((d) => addDays(d, currentView === 'week' ? 7 : 1))}>›</NavBtn>
        </div>

        <span style={{ fontSize: '14px', color: C.heading }}>
          {currentView === 'day'
            ? formatDateLong(currentDate)
            : `Week of ${formatDateLong(startOfWeek(currentDate))}`}
        </span>

        <button onClick={() => setShowNew(true)} style={{ ...navBtnStyle, marginLeft: 'auto', backgroundColor: C.green, color: '#fff', border: 'none' }}>
          + New Task
        </button>
      </div>

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>
          {error} <button onClick={() => setError('')} style={{ ...linkBtn }}>dismiss</button>
        </div>
      )}

      {loading || !lookups ? (
        <div style={{ padding: '40px', textAlign: 'center', color: C.muted }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {currentView === 'day' ? (
            <DayTimeline
              dateStr={currentDate}
              now={now}
              tasks={tasksForCurrentDate}
              taskTypes={lookups.taskTypes}
              fields={lookups.fields}
              resources={lookups.resources}
              onToggleComplete={handleToggleComplete}
              onDelete={handleDelete}
              onSelect={setEditingTask}
            />
          ) : (
            <WeekGrid
              weekStart={startOfWeek(currentDate)}
              now={now}
              tasks={tasks}
              taskTypes={lookups.taskTypes}
              fields={lookups.fields}
              resources={lookups.resources}
              onSelectDate={(d) => {
                setCurrentDate(d)
                setCurrentView('day')
              }}
              onSelectTask={setEditingTask}
            />
          )}

          <ResourcePool
            resources={lookups.resources}
            tasks={tasksForCurrentDate}
            dateStr={currentDate}
            now={now}
            onAddResource={(input) => {
              handleAddResource(input).catch((e) => setError(msg(e)))
            }}
            onUpdateResource={(id, patch) => {
              handleUpdateResource(id, patch).catch((e) => setError(msg(e)))
            }}
          />

          <TeamsPanel
            groups={lookups.defaultGroups}
            taskTypes={lookups.taskTypes}
            resources={lookups.resources}
            onCreate={(input, resourceIds) => {
              handleCreateGroup(input, resourceIds).catch((e) => setError(msg(e)))
            }}
            onUpdate={(id, patch, resourceIds) => {
              handleUpdateGroup(id, patch, resourceIds).catch((e) => setError(msg(e)))
            }}
            onDelete={(id) => {
              handleDeleteGroup(id).catch((e) => setError(msg(e)))
            }}
          />
        </div>
      )}

      {showNew && lookups && (
        <NewTaskModal
          dateStr={currentDate}
          now={now}
          taskTypes={lookups.taskTypes}
          fields={lookups.fields}
          resources={lookups.resources}
          defaultGroups={lookups.defaultGroups}
          tasksForDate={tasksForCurrentDate}
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
          onAddField={handleAddField}
          onAddResource={handleAddResource}
        />
      )}

      {editingTask && lookups && (
        <EditTaskModal
          task={editingTask}
          now={now}
          taskTypes={lookups.taskTypes}
          fields={lookups.fields}
          resources={lookups.resources}
          tasks={tasks}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTask}
          onDelete={handleDelete}
          onAddField={handleAddField}
          onAddResource={handleAddResource}
        />
      )}

      <div style={{ marginTop: '24px' }}>
        <button onClick={signOut} style={linkBtn}>
          Sign out
        </button>
      </div>
    </Shell>
  )
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: C.serif,
        padding: '16px 24px 48px',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '18px' }}>
          <button onClick={onBack} style={linkBtn}>
            ‹ Field Ops
          </button>
          <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: C.muted, textTransform: 'uppercase' }}>
            Task Orchestrator
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={navBtnStyle}>
      {children}
    </button>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'none',
  border: `1px solid ${C.border}`,
  color: C.mutedBright,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.muted,
  cursor: 'pointer',
  fontSize: '12px',
  padding: 0,
  textDecoration: 'underline',
}

function msg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong.'
}

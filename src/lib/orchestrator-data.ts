'use client'

// Supabase data layer for the Task Orchestrator.
// Uses the *authenticated* browser client (@supabase/ssr) so auth.uid() is
// populated and the has_orchestrator_access() RLS policies apply. The rest of
// the app uses the session-less client in src/lib/supabase.ts — do not use that
// one here or every read comes back empty.

import { createBrowserClient } from '@supabase/ssr'
import type {
  DefaultGroup,
  FieldSection,
  NewTaskInput,
  OrchestratorField,
  Resource,
  Task,
  TaskType,
} from './orchestrator'

let client: ReturnType<typeof createBrowserClient> | null = null

export function orchestratorClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}

export type Lookups = {
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  defaultGroups: DefaultGroup[]
}

/** Low-change reference data — fetch once per session. */
export async function fetchLookups(): Promise<Lookups> {
  const c = orchestratorClient()
  const [taskTypesRes, fieldsRes, resourcesRes, groupsRes] = await Promise.all([
    c.from('task_types').select('id, name').order('name'),
    c.from('fields').select('id, name, active, region, client').order('name'),
    c
      .from('resources')
      .select(
        'id, name, type, shift_start, shift_end, available_days, category, division, active, source, external_id',
      )
      .order('type')
      .order('name'),
    c
      .from('default_groups')
      .select('id, task_type_id, name, shift_start, shift_end, default_group_resources(resource_id)')
      .order('name'),
  ])

  for (const res of [taskTypesRes, fieldsRes, resourcesRes, groupsRes]) {
    if (res.error) throw res.error
  }

  const defaultGroups: DefaultGroup[] = (groupsRes.data ?? []).map((g: Record<string, unknown>) => ({
    id: g.id as string,
    task_type_id: g.task_type_id as string,
    name: g.name as string,
    shift_start: (g.shift_start as number | null) ?? null,
    shift_end: (g.shift_end as number | null) ?? null,
    resource_ids: ((g.default_group_resources as { resource_id: string }[] | null) ?? []).map(
      (r) => r.resource_id,
    ),
  }))

  return {
    taskTypes: (taskTypesRes.data ?? []) as TaskType[],
    fields: ((fieldsRes.data ?? []) as OrchestratorField[]).filter((f) => f.active !== false),
    resources: ((resourcesRes.data ?? []) as Resource[]).filter((r) => r.active !== false),
    defaultGroups,
  }
}

function mapTaskRow(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    task_type_id: row.task_type_id as string,
    field_id: (row.field_id as string | null) ?? null,
    task_date: row.task_date as string,
    start_hour: Number(row.start_hour),
    end_hour: Number(row.end_hour),
    all_day: Boolean(row.all_day),
    completed: Boolean(row.completed),
    completed_at: (row.completed_at as string | null) ?? null,
    resource_ids: ((row.task_resources as { resource_id: string }[] | null) ?? []).map(
      (r) => r.resource_id,
    ),
    details: (row.details as Task['details']) ?? null,
  }
}

/** Tasks (+ assigned resources) for a set of dates. */
export async function fetchTasks(dateStrs: string[]): Promise<Task[]> {
  if (dateStrs.length === 0) return []
  const c = orchestratorClient()
  const { data, error } = await c
    .from('tasks')
    .select('*, task_resources(resource_id)')
    .in('task_date', dateStrs)
    .order('start_hour')
  if (error) throw error
  return (data ?? []).map(mapTaskRow)
}

export async function createTask(input: NewTaskInput, resourceIds: string[]): Promise<string> {
  const c = orchestratorClient()
  const {
    data: { user },
  } = await c.auth.getUser()

  const { data, error } = await c
    .from('tasks')
    .insert({ ...input, created_by: user?.id ?? null })
    .select('id')
    .single()
  if (error) throw error

  const taskId = data.id as string
  if (resourceIds.length) {
    const { error: e2 } = await c
      .from('task_resources')
      .insert(resourceIds.map((rid) => ({ task_id: taskId, resource_id: rid })))
    if (e2) throw e2
  }
  return taskId
}

export async function updateTask(taskId: string, patch: Partial<NewTaskInput>): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c.from('tasks').update(patch).eq('id', taskId)
  if (error) throw error
}

/**
 * Completing a task clears its `asset` resources (they're freed for other work)
 * but keeps the employees on it. Un-completing just flips the flag back.
 */
export async function setTaskCompleted(
  taskId: string,
  completed: boolean,
  assetResourceIds: string[] = [],
): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c
    .from('tasks')
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq('id', taskId)
  if (error) throw error

  if (completed && assetResourceIds.length) {
    const { error: e2 } = await c
      .from('task_resources')
      .delete()
      .eq('task_id', taskId)
      .in('resource_id', assetResourceIds)
    if (e2) throw e2
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}

export async function assignResource(taskId: string, resourceId: string): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c
    .from('task_resources')
    .upsert({ task_id: taskId, resource_id: resourceId }, { onConflict: 'task_id,resource_id' })
  if (error) throw error
}

export async function unassignResource(taskId: string, resourceId: string): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c
    .from('task_resources')
    .delete()
    .eq('task_id', taskId)
    .eq('resource_id', resourceId)
  if (error) throw error
}

// ── Manual "add new" affordances (source = 'manual') ───────────────────────

export async function addManualResource(input: {
  name: string
  type: 'asset' | 'employee'
  shift_start: number | null
  shift_end: number | null
  available_days?: number[] | null
  category?: string | null
  division?: string | null
}): Promise<Resource> {
  const c = orchestratorClient()
  const { data, error } = await c
    .from('resources')
    .insert({ available_days: null, category: null, division: null, ...input, source: 'manual', external_id: null })
    .select(
      'id, name, type, shift_start, shift_end, available_days, category, division, active, source, external_id',
    )
    .single()
  if (error) throw error
  return data as Resource
}

/**
 * Edit a resource's name / type / shift window, or deactivate it.
 * Deactivating (active: false) never deletes the row — a resource can be
 * referenced by past task_resources rows, and `resources` is `on delete
 * cascade` from `tasks`, so a hard delete would silently drop history off
 * completed tasks. Same "deactivate, don't delete" pattern as the JD asset
 * sync and the "Hide" flow on the main calendar.
 */
export async function updateResource(
  id: string,
  patch: Partial<{
    name: string
    type: 'asset' | 'employee'
    shift_start: number | null
    shift_end: number | null
    available_days: number[] | null
    category: string | null
    division: string | null
    active: boolean
  }>,
): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c.from('resources').update(patch).eq('id', id)
  if (error) throw error
}

/** Section decides which of region / client the new field gets, so it shows up under itself immediately. */
export async function addManualField(name: string, section: FieldSection): Promise<OrchestratorField> {
  const c = orchestratorClient()
  const placement = section === 'LB Pork' ? { client: 'LB Pork', region: null } : { region: section, client: null }
  const { data, error } = await c
    .from('fields')
    .insert({ name, source: 'manual', external_id: null, active: true, ...placement })
    .select('id, name, active, region, client')
    .single()
  if (error) throw error
  return data as OrchestratorField
}

// ── Default (saved) crews / "teams" ─────────────────────────────────────────

export async function createDefaultGroup(
  input: { task_type_id: string; name: string; shift_start: number | null; shift_end: number | null },
  resourceIds: string[],
): Promise<string> {
  const c = orchestratorClient()
  const { data, error } = await c.from('default_groups').insert(input).select('id').single()
  if (error) throw error

  const groupId = data.id as string
  if (resourceIds.length) {
    const { error: e2 } = await c
      .from('default_group_resources')
      .insert(resourceIds.map((rid) => ({ group_id: groupId, resource_id: rid })))
    if (e2) throw e2
  }
  return groupId
}

/** Pass `resourceIds` to replace the team's membership; omit to leave it alone. */
export async function updateDefaultGroup(
  id: string,
  patch: Partial<{ task_type_id: string; name: string; shift_start: number | null; shift_end: number | null }>,
  resourceIds?: string[],
): Promise<void> {
  const c = orchestratorClient()
  if (Object.keys(patch).length) {
    const { error } = await c.from('default_groups').update(patch).eq('id', id)
    if (error) throw error
  }
  if (resourceIds) {
    const { error: delErr } = await c.from('default_group_resources').delete().eq('group_id', id)
    if (delErr) throw delErr
    if (resourceIds.length) {
      const { error: insErr } = await c
        .from('default_group_resources')
        .insert(resourceIds.map((rid) => ({ group_id: id, resource_id: rid })))
      if (insErr) throw insErr
    }
  }
}

/** Teams are just saved selections — deleting one never touches any task. */
export async function deleteDefaultGroup(id: string): Promise<void> {
  const c = orchestratorClient()
  const { error } = await c.from('default_groups').delete().eq('id', id)
  if (error) throw error
}

// ── Access check ──────────────────────────────────────────────────────────

export type OrchestratorRole = 'owner' | 'admin' | 'manager'

/** null => the current login has no orchestrator role (show the no-access notice). */
export async function fetchMyRole(): Promise<OrchestratorRole | null> {
  const c = orchestratorClient()
  const {
    data: { user },
  } = await c.auth.getUser()
  if (!user) return null
  const { data, error } = await c.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (error || !data) return null
  return data.role as OrchestratorRole
}

// ── Realtime ──────────────────────────────────────────────────────────────

/**
 * Subscribe to task / assignment changes. Returns an unsubscribe fn. Best
 * effort: if the `supabase_realtime` publication doesn't include these tables
 * the callback simply never fires and callers still refetch on their own
 * mutations.
 */
export function subscribeToTasks(onChange: () => void): () => void {
  const c = orchestratorClient()
  const channel = c
    .channel('orchestrator-tasks')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_resources' }, onChange)
    .subscribe()
  return () => {
    c.removeChannel(channel)
  }
}

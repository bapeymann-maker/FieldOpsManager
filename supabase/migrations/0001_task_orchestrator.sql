-- ============================================================================
-- Task Orchestrator — migration (reconciled with the live FieldOpsManager DB)
-- ============================================================================
-- Replaces spt_files/schema.sql. Key differences from that draft:
--
--   * `fields` already exists (name, acres, region, boundary, client, cert_*).
--     We ALTER it to add sync columns instead of recreating it, and we do NOT
--     seed field rows — the real rows are already there.
--   * `machines` already exists (John Deere equipment, populated by
--     app/api/jd/machines-sync). `resources` is new and holds BOTH assets and
--     employees for scheduling; asset rows are mirrored from `machines` by
--     app/api/orchestrator/sync-resources (resources.external_id = machines.id).
--   * RLS is enabled ONLY on the new orchestrator tables. The existing app
--     reads shared tables (fields, operations, gdu_daily, ...) with a
--     session-less anon client, so enabling RLS on them would break the
--     dashboard. Do NOT add RLS to `fields` here.
--   * The orchestrator UI talks to Supabase with the *authenticated* browser
--     client (@supabase/ssr createBrowserClient), so auth.uid() is populated
--     and the policies below apply.
--
-- Apply with the Supabase SQL editor or `supabase db push`. Safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Extend the existing `fields` table ────────────────────────────────────
alter table fields add column if not exists active         boolean not null default true;
alter table fields add column if not exists source         text    not null default 'manual';
alter table fields add column if not exists external_id    text;
alter table fields add column if not exists last_synced_at timestamptz;

do $$ begin
  alter table fields add constraint fields_source_check
    check (source in ('gis','john_deere','manual'));
exception when duplicate_object then null; end $$;

-- Not partial: Postgres never treats two NULLs as equal, so a plain unique
-- index already allows unlimited manually-added rows (external_id null) while
-- still rejecting duplicate synced ids — and, unlike a partial index, it works
-- as an ON CONFLICT (external_id) upsert target without repeating the WHERE.
create unique index if not exists idx_fields_external
  on fields(external_id);

-- ── Lookups ──────────────────────────────────────────────────────────────
create table if not exists task_types (
  id   uuid primary key default gen_random_uuid(),
  name text unique not null                 -- Harvest, Tillage, Hauling, Manure, Other
);

-- ── Resources (assets + employees) ───────────────────────────────────────
-- Asset rows are mirrored from `machines` (external_id = machines.id,
-- source = 'john_deere'). Employees and off-book equipment are source =
-- 'manual' with external_id null. The picker UI does not distinguish them.
create table if not exists resources (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null check (type in ('asset','employee')),
  -- shift window in local hours 0-23; shift_end < shift_start means it wraps
  -- past midnight. null/null means "always available".
  shift_start    smallint check (shift_start between 0 and 23),
  shift_end      smallint check (shift_end   between 0 and 23),
  active         boolean not null default true,
  source         text not null default 'manual' check (source in ('john_deere','manual')),
  external_id    text,                       -- machines.id for synced assets; null otherwise
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);

-- Not partial — see the idx_fields_external comment above; same reasoning,
-- and required for the sync-resources upsert's ON CONFLICT (external_id).
create unique index if not exists idx_resources_external
  on resources(external_id);

-- ── Default (saved) crews, e.g. "Harvest 1 Day" ──────────────────────────
create table if not exists default_groups (
  id           uuid primary key default gen_random_uuid(),
  task_type_id uuid not null references task_types(id) on delete cascade,
  name         text not null,
  shift_start  smallint check (shift_start between 0 and 23),
  shift_end    smallint check (shift_end   between 0 and 23),
  created_at   timestamptz not null default now()
);

create table if not exists default_group_resources (
  group_id    uuid not null references default_groups(id) on delete cascade,
  resource_id uuid not null references resources(id)      on delete cascade,
  primary key (group_id, resource_id)
);

-- ── Tasks (the field plans / "field ops events") ─────────────────────────
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  task_type_id uuid not null references task_types(id),
  field_id     uuid references fields(id),
  task_date    date not null,
  start_hour   numeric not null default 8,   -- may exceed 24 to represent crossing midnight
  end_hour     numeric not null default 10,
  all_day      boolean not null default false,
  completed    boolean not null default false,
  completed_at timestamptz,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists task_resources (
  task_id     uuid not null references tasks(id)     on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  primary key (task_id, resource_id)
);

create index if not exists idx_tasks_date            on tasks(task_date);
create index if not exists idx_task_resources_resource on task_resources(resource_id);

-- ── updated_at trigger ───────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
before update on tasks
for each row execute function set_updated_at();

-- ── Seed lookups (only task_types; fields already exist) ──────────────────
insert into task_types (name) values
  ('Harvest'), ('Tillage'), ('Hauling'), ('Manure'), ('Other')
on conflict (name) do nothing;

-- ── Realtime (optional; lets multiple managers see edits live) ────────────
do $$ begin
  alter publication supabase_realtime add table tasks;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table task_resources;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ============================================================================
-- Access control
-- ============================================================================
-- Three logins exist (Supabase Auth -> Users). Employees are data records in
-- `resources`, never auth users. Everything in this module is gated to these
-- three roles. If FieldOpsManager later grows its own roles/profiles table,
-- drop this one and repoint has_orchestrator_access() at it.
create table if not exists profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  role      text not null check (role in ('owner','admin','manager')),
  full_name text
);

alter table profiles                enable row level security;
alter table task_types              enable row level security;
alter table resources               enable row level security;
alter table default_groups          enable row level security;
alter table default_group_resources enable row level security;
alter table tasks                   enable row level security;
alter table task_resources          enable row level security;

-- SECURITY DEFINER so it can read `profiles` regardless of that table's policies
create or replace function has_orchestrator_access() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('owner','admin','manager')
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'task_types','resources','default_groups','default_group_resources',
    'tasks','task_resources'
  ] loop
    execute format('drop policy if exists "orchestrator access" on %I', t);
    execute format(
      'create policy "orchestrator access" on %I for all
         using (has_orchestrator_access()) with check (has_orchestrator_access())', t);
  end loop;
end $$;

-- a user may always read their own profile row (used by the UI access check)
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select using (id = auth.uid());

-- ── Seed the three existing logins ───────────────────────────────────────
-- Re-check these UIDs against Supabase Auth -> Users before running if the
-- accounts have ever been recreated.
insert into profiles (id, role, full_name) values
  ('aa8ea464-ad14-4871-8afd-e2d257055767', 'admin',   'Benjamin Peymann'),
  ('43fc6ff4-5a5f-478b-a734-679138bd984c', 'owner',   'John Ufer'),
  ('e573f7da-c100-42c4-9d94-bccbceaacc41', 'manager', 'Wilhelm')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

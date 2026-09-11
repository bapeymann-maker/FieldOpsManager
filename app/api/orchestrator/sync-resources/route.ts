import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Mirrors John Deere equipment from the existing `machines` table (populated by
// app/api/jd/machines-sync) into `resources` so it can be scheduled. This is a
// thin stub: it does not talk to John Deere directly — machines-sync already
// does. Run it after machines-sync, or wire both into the Vercel cron chain in
// app/api/cron/sync (Vercel Hobby allows only one cron entry).
//
// Auth: internal header (from the cron route) or a bearer CRON_SECRET.
// Requires SUPABASE_SERVICE_KEY (set in the deploy env, like machines-sync) so
// the write bypasses the `resources` RLS policy.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const internal = request.headers.get('x-internal')
  if (internal !== 'true' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: machines, error } = await supabase
    .from('machines')
    .select('id, name, type, archived')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = new Date().toISOString()
  const seen = new Set<string>()
  let upserted = 0
  const failures: string[] = []

  for (const m of machines ?? []) {
    seen.add(m.id)
    // onConflict targets the partial unique index idx_resources_external
    // (external_id where not null).
    const { error: upErr } = await supabase.from('resources').upsert(
      {
        name: m.name || `Machine ${m.id}`,
        type: 'asset',
        source: 'john_deere',
        external_id: m.id,
        active: !m.archived,
        last_synced_at: now,
      },
      { onConflict: 'external_id' },
    )
    if (upErr) failures.push(`${m.id}: ${upErr.message}`)
    else upserted++
  }

  // Deactivate — never delete — synced assets JD no longer returns, so
  // historical tasks that reference them don't break.
  let deactivated = 0
  const { data: existing } = await supabase
    .from('resources')
    .select('id, external_id, active')
    .eq('source', 'john_deere')
    .not('external_id', 'is', null)

  const stale = (existing ?? []).filter((r) => r.active && r.external_id && !seen.has(r.external_id))
  if (stale.length) {
    const { error: deErr } = await supabase
      .from('resources')
      .update({ active: false, last_synced_at: now })
      .in(
        'id',
        stale.map((r) => r.id),
      )
    if (!deErr) deactivated = stale.length
  }

  return NextResponse.json({
    success: failures.length === 0,
    machines: machines?.length ?? 0,
    upserted,
    deactivated,
    failures,
  })
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'

async function getAccessToken() {
  const { data } = await supabase.from('jd_tokens').select('*').eq('id', 1).single()
  if (!data) throw new Error('No token found')
  return data.access_token
}

export async function GET() {
  try {
    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    const machines = [
      { name: '8RT 370 #3', id: '4844531', principalId: '1332364' },
      { name: '9RT 570 #20', id: '5400560', principalId: '1400656' },
      { name: '9620RX #21', id: '6274249', principalId: '556974' },
    ]

    const results: any[] = []
    for (const m of machines) {
      const r1 = await fetch(`${JD_BASE}/machines/${m.id}/locationHistory?itemLimit=3`, { headers })
      const r2 = await fetch(`${JD_BASE}/machines/${m.principalId}/locationHistory?itemLimit=3`, { headers })
      const d1 = await r1.json()
      const d2 = await r2.json()
      results.push({
        name: m.name,
        by_id: { status: r1.status, total: d1.total, sample: d1.values?.[0]?.eventTimestamp },
        by_principalId: { status: r2.status, total: d2.total, sample: d2.values?.[0]?.eventTimestamp }
      })
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
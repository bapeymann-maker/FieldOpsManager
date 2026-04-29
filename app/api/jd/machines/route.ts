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

    // Test machine 1309550 (Ufer DB60 planter — had recent activity)
    const machineId = '1309550'
    const results: Record<string, number> = {}

    // Test different lookback windows
    const windows = [7, 14, 30, 60, 90, 180, 365]
    for (const days of windows) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      const until = new Date().toISOString()
      const res = await fetch(
        `${JD_BASE}/machines/${machineId}/locationHistory?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(until)}&itemLimit=1`,
        { headers }
      )
      const data = await res.json()
      results[`${days}_days`] = data.total || 0
    }

    return NextResponse.json({ machine: machineId, results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
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

    const res = await fetch(
      `${JD_BASE}/machines/751937/deviceStateReports?startDate=${encodeURIComponent('2026-04-10T00:00:00Z')}&endDate=${encodeURIComponent('2026-04-13T00:00:00Z')}&itemLimit=100`,
      { headers }
    )
    const data = await res.json()

    return NextResponse.json({
      total: data.total,
      count: data.values?.length,
      first: data.values?.[data.values.length - 1]?.time,
      last: data.values?.[0]?.time
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
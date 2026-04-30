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

    const since = '2026-04-11T00:00:00Z'
    const until = '2026-04-12T23:59:59Z'
    const res = await fetch(
      `${JD_BASE}/machines/751937/deviceStateReports?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(until)}&itemLimit=100`,
      { headers }
    )
    const data = await res.json()

    return NextResponse.json({
      status: res.status,
      total: data.total,
      values: data.values?.map((v: any) => ({
        time: v.time,
        engineState: v.engineState,
        vehiclePowerState: v.vehiclePowerState,
        lat: v.location?.lat,
        lon: v.location?.lon
      }))
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
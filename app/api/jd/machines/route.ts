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

    const isgRes = await fetch('https://api.deere.com/isg/equipment?organizationIds=464281', { headers })
    const isgData = await isgRes.json()
    const allMachines = isgData.values || []

    // Test device state reports for both planters
    const targets = ['1309550', '5464383']
    const results: any[] = []

    for (const id of targets) {
      const m = allMachines.find((m: any) => m.id === id)
      const platformId = m?.principalId || id
      const res = await fetch(
        `${JD_BASE}/machines/${platformId}/deviceStateReports?itemLimit=5`,
        { headers }
      )
      const text = await res.text()
      let data: any = null
      try { data = JSON.parse(text) } catch (e) {}
      results.push({
        id,
        name: m?.name,
        platformId,
        status: res.status,
        total: data?.total,
        sample: data?.values?.[0]
      })
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
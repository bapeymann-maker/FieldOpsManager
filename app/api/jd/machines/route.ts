import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
const ORG_ID = '464281'
const MACHINE_ID = '1578646' // 8R 340 #8 platformId

async function getAccessToken() {
  const { data } = await supabase.from('jd_tokens').select('*').eq('id', 1).single()
  if (!data) throw new Error('No token found')
  if (new Date(data.expires_at) < new Date()) {
    const response = await fetch('https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.JOHN_DEERE_CLIENT_ID + ':' + process.env.JOHN_DEERE_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token
      })
    })
    const tokens = await response.json()
    await supabase.from('jd_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    }).eq('id', 1)
    return tokens.access_token
  }
  return data.access_token
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') || 'machine-links'

  try {
    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    if (mode === 'machine-links') {
      const res = await fetch(`${JD_BASE}/machines/${MACHINE_ID}`, { headers })
      const data = await res.json()
      return NextResponse.json({ mode, status: res.status, links: data.links?.map((l: any) => ({ rel: l.rel, uri: l.uri })), fields: Object.keys(data).filter(k => k !== 'links') })
    }
    if (mode === 'org-links') {
      const res = await fetch(`${JD_BASE}/organizations/${ORG_ID}`, { headers })
      const data = await res.json()
      return NextResponse.json({ mode, status: res.status, links: data.links?.map((l: any) => ({ rel: l.rel, uri: l.uri })), fields: Object.keys(data).filter(k => k !== 'links') })
    }
    if (mode === 'org-operations') {
      const res = await fetch(`${JD_BASE}/organizations/${ORG_ID}/operations?startDate=${encodeURIComponent('2026-05-07T00:00:00Z')}&endDate=${encodeURIComponent('2026-05-08T00:00:00Z')}`, { headers })
      return NextResponse.json({ mode, status: res.status, data: await res.json() })
    }
    if (mode === 'machine-operations') {
      const res = await fetch(`${JD_BASE}/machines/${MACHINE_ID}/operations?startDate=${encodeURIComponent('2026-05-07T00:00:00Z')}&endDate=${encodeURIComponent('2026-05-08T00:00:00Z')}`, { headers })
      return NextResponse.json({ mode, status: res.status, data: await res.json() })
    }
    if (mode === 'field-operations') {
      const res = await fetch(`${JD_BASE}/organizations/${ORG_ID}/fieldOperations?startDate=${encodeURIComponent('2026-05-07T00:00:00Z')}&endDate=${encodeURIComponent('2026-05-08T00:00:00Z')}`, { headers })
      return NextResponse.json({ mode, status: res.status, data: await res.json() })
    }
    if (mode === 'location-history') {
      const res = await fetch(`${JD_BASE}/machines/${MACHINE_ID}/locationHistory?startDate=${encodeURIComponent('2026-05-07T00:00:00Z')}&endDate=${encodeURIComponent('2026-05-08T00:00:00Z')}&itemLimit=10`, { headers })
      const data = await res.json()
      return NextResponse.json({ mode, status: res.status, total: data.total, count: data.values?.length, sample: data.values?.slice(0, 3), links: data.links?.map((l: any) => ({ rel: l.rel, uri: l.uri })) })
    }
    return NextResponse.json({ error: 'Unknown mode' })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

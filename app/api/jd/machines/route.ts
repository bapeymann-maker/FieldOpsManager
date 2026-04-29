import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    const isgRes = await fetch(
      'https://api.deere.com/isg/equipment?organizationIds=464281',
      { headers }
    )
    const isgData = await isgRes.json()
    const targets = ['4844531', '5400560', '6274249']
    const found = isgData.values?.filter((m: any) => targets.includes(m.id))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        ERID: m.ERID,
        principalId: m.principalId,
        links: m.links?.map((l: any) => ({ rel: l.rel, uri: l.uri }))
      }))

    return NextResponse.json({ found })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
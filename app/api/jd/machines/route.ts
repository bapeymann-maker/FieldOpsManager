import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ORG_ID = '464281'

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
      `https://api.deere.com/isg/equipment?organizationIds=${ORG_ID}`,
      { headers }
    )
    const data = await res.json()

    return NextResponse.json({
      total: data.values?.length || 0,
      telematics_capable: data.values?.filter((m: any) => m.telematicsCapable && !m.archived).map((m: any) => ({
        id: m.id,
        name: m.name,
        type: m.type?.name,
        telematics: m.telematicsCapable
      })) || []
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
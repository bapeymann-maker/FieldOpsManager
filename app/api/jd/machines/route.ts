import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
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

    // Get machines/assets for the org
    const res = await fetch(`${JD_BASE}/organizations/${ORG_ID}/machines?itemLimit=100`, { headers })
const text = await res.text()

const res2 = await fetch(`${JD_BASE}/organizations/${ORG_ID}/assets?itemLimit=100`, { headers })
const text2 = await res2.text()

return NextResponse.json({
  machines_status: res.status,
  machines_raw: text.slice(0, 500),
  assets_status: res2.status,
  assets_raw: text2.slice(0, 500)
})
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
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

    const endpoints = [
  `/organizations/${ORG_ID}`,
  `/organizations/${ORG_ID}/machines`,
  `/organizations/${ORG_ID}/machines?memberFilter=owned`,
  `/organizations/${ORG_ID}/machineRegistrations`,
  `/organizations/${ORG_ID}/jdlinkMachines`,
]

    const results: Record<string, { status: number; body: string }> = {}

    for (const ep of endpoints) {
      const res = await fetch(`${JD_BASE}${ep}?itemLimit=5`, { headers })
      const text = await res.text()
      results[ep] = { status: res.status, body: text.slice(0, 200) }
    }

    // Also check what scopes the current token has
    const tokenRes = await fetch('https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(process.env.JOHN_DEERE_CLIENT_ID + ':' + process.env.JOHN_DEERE_CLIENT_SECRET).toString('base64') },
      body: new URLSearchParams({ token })
    })
    const tokenData = await tokenRes.json()

    return NextResponse.json({ results, token_scopes: tokenData.scope, token_active: tokenData.active })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
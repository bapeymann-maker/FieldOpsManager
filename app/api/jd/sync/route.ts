import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  try {
    const { data: tokenData } = await supabase
      .from('jd_tokens')
      .select('*')
      .eq('id', 1)
      .single()

    if (!tokenData) return NextResponse.json({ error: 'No token found' })

    const token = tokenData.access_token
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    // Get organizations
    const orgsRes = await fetch('https://sandboxapi.deere.com/platform/organizations', { headers })
    const orgsData = await orgsRes.json()

    return NextResponse.json({ orgsData })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
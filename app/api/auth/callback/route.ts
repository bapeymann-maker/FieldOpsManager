import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/?error=' + error, request.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', request.url))
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.JOHN_DEERE_CLIENT_ID + ':' + process.env.JOHN_DEERE_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.NEXT_PUBLIC_BASE_URL + '/api/auth/callback'
      })
    })

    const tokens = await tokenResponse.json()

    if (tokens.error) {
      return NextResponse.redirect(new URL('/?error=' + tokens.error, request.url))
    }

    // Store tokens in Supabase
    await supabase.from('jd_tokens').upsert({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    })

    return NextResponse.redirect(new URL('/?connected=true', request.url))
  } catch (err) {
    console.error('OAuth error:', err)
    return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url))
  }
}
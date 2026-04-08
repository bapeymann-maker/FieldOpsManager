import { NextResponse } from 'next/server'

export async function GET() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.JOHN_DEERE_CLIENT_ID!,
    redirect_uri: process.env.NEXT_PUBLIC_BASE_URL + '/api/auth/callback',
    scope: 'ag1 ag2 ag3 eq1 eq2 files offline_access',
    state: 'field-ops-manager'
  })

  const authUrl = `https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize?${params}`

  return NextResponse.redirect(authUrl)
}
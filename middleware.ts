import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('sb-tpcwaghvlwkcgqyaonzk-auth-token')

  if (!token && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0f1410', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif'
    }}>
      <div style={{
        backgroundColor: '#111612', border: '1px solid #2a3020',
        borderRadius: '8px', padding: '48px', width: '400px'
      }}>
        <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#6b7a5a', textTransform: 'uppercase', marginBottom: '8px' }}>
          Field Operations Manager
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 'normal', color: '#c8d4a0', margin: '0 0 32px' }}>
          Sign In
        </h1>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Email
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{
            width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
            border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
            fontSize: '14px', boxSizing: 'border-box'
          }} />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Password
          </label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{
              width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
              border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
              fontSize: '14px', boxSizing: 'border-box'
            }} />
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading} style={{
          width: '100%', padding: '10px', backgroundColor: '#2d6a2d',
          border: 'none', color: '#fff', borderRadius: '4px',
          cursor: 'pointer', fontSize: '14px', letterSpacing: '0.05em'
        }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}
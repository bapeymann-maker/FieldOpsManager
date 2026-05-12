import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
const ORG_ID = '464281'

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

// Normalize field name for fuzzy matching — strip punctuation, extra spaces, lowercase
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

export async function GET() {
  try {
    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    // 1. Load all Supabase fields
    const { data: supabaseFields } = await supabase
      .from('fields')
      .select('id, name')

    if (!supabaseFields?.length) {
      return NextResponse.json({ error: 'No fields found in Supabase' }, { status: 400 })
    }

    // Build a normalized name → id lookup
    const fieldLookup: Record<string, string> = {}
    for (const f of supabaseFields) {
      fieldLookup[normalizeName(f.name)] = f.id
    }

    // 2. Fetch all JD fields (paginated)
    let jdFields: { name: string; links: any[] }[] = []
    let fieldsUrl: string = `${JD_BASE}/organizations/${ORG_ID}/fields?itemLimit=100`

    while (fieldsUrl) {
      const res = await fetch(fieldsUrl, { headers })
      if (!res.ok) break
      const data = await res.json()
      jdFields = jdFields.concat(data.values || [])
      const next = data.links?.find((l: any) => l.rel === 'nextPage')
      fieldsUrl = next?.uri || ''
      await new Promise(r => setTimeout(r, 150))
    }

    console.log(`Fetched ${jdFields.length} JD fields`)

    // 3. For each JD field, find matching Supabase field and fetch boundary
    const results: { field: string; status: string; matched?: string }[] = []
    let updated = 0
    let skipped = 0
    let noMatch = 0
    let noBoundary = 0

    for (const jdField of jdFields) {
      const jdName = jdField.name || ''
      const normalizedJdName = normalizeName(jdName)

      // Find matching Supabase field — try exact match first, then partial
      let supabaseId = fieldLookup[normalizedJdName]

      if (!supabaseId) {
        // Try partial match: JD name contains or is contained by Supabase name
        const match = Object.entries(fieldLookup).find(([sbName]) =>
          sbName.includes(normalizedJdName) || normalizedJdName.includes(sbName)
        )
        if (match) supabaseId = match[1]
      }

      if (!supabaseId) {
        results.push({ field: jdName, status: 'no_match' })
        noMatch++
        continue
      }

      const matchedField = supabaseFields.find(f => f.id === supabaseId)

      // Find boundary link on the JD field resource
      const boundaryLink = jdField.links?.find((l: any) =>
        l.rel === 'boundary' || l.rel === 'boundaries'
      )

      if (!boundaryLink?.uri) {
        // Try fetching the field directly to get its links
        const fieldSelfLink = jdField.links?.find((l: any) => l.rel === 'self')
        if (fieldSelfLink?.uri) {
          const fieldRes = await fetch(fieldSelfLink.uri, { headers })
          if (fieldRes.ok) {
            const fieldData = await fieldRes.json()
            const bLink = fieldData.links?.find((l: any) =>
              l.rel === 'boundary' || l.rel === 'boundaries' || l.rel === 'activeFieldBoundary'
            )
            if (bLink?.uri) {
              await fetchAndUpdateBoundary(bLink.uri, supabaseId, jdName, matchedField?.name || '', headers, results)
              updated++
              continue
            }
          }
        }
        results.push({ field: jdName, status: 'no_boundary_link', matched: matchedField?.name })
        noBoundary++
        await new Promise(r => setTimeout(r, 100))
        continue
      }

      await fetchAndUpdateBoundary(boundaryLink.uri, supabaseId, jdName, matchedField?.name || '', headers, results)
      updated++
      await new Promise(r => setTimeout(r, 150))
    }

    return NextResponse.json({
      success: true,
      jd_fields_fetched: jdFields.length,
      updated,
      skipped,
      no_match: noMatch,
      no_boundary: noBoundary,
      details: results
    })

  } catch (err) {
    console.error('Boundary sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function fetchAndUpdateBoundary(
  boundaryUri: string,
  supabaseId: string,
  jdName: string,
  matchedName: string,
  headers: Record<string, string>,
  results: { field: string; status: string; matched?: string }[]
) {
  try {
    const bRes = await fetch(boundaryUri, { headers })
    if (!bRes.ok) {
      results.push({ field: jdName, status: `boundary_fetch_failed_${bRes.status}`, matched: matchedName })
      return
    }
    const bData = await bRes.json()

    // Extract the GeoJSON geometry from the boundary response
    // JD boundary responses can have different shapes — try several paths
    let geometry =
      bData.multipolygons?.[0] ||
      bData.boundary ||
      bData.geometry ||
      bData

    // If it has values array (paginated), take first
    if (bData.values?.length > 0) {
      const first = bData.values[0]
      geometry = first.multipolygons?.[0] || first.boundary || first.geometry || first
    }

    // Ensure it has a valid GeoJSON type
    if (!geometry?.type || !geometry?.coordinates) {
      results.push({ field: jdName, status: 'invalid_geometry', matched: matchedName })
      return
    }

    const { error } = await supabase
      .from('fields')
      .update({ boundary: geometry })
      .eq('id', supabaseId)

    if (error) {
      results.push({ field: jdName, status: `db_error: ${error.message}`, matched: matchedName })
    } else {
      results.push({ field: jdName, status: 'updated', matched: matchedName })
    }
  } catch (err) {
    results.push({ field: jdName, status: `error: ${String(err)}`, matched: matchedName })
  }
}
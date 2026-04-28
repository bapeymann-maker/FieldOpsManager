import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
const ORG_ID = '464281'

const RELEVANT_TYPES = new Set([
  'Track Tractor', 'Wheel Tractor', 'Tractor', 'Combine', 'Sprayer', 'Planter'
])

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

function pointInPolygon(lat: number, lon: number, polygon: number[][]): boolean {
  let inside = false
  const x = lon, y = lat
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function extractCoords(geometry: any): number[][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates[0]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0][0]
  if (geometry.type === 'Feature') return extractCoords(geometry.geometry)
  if (geometry.type === 'FeatureCollection') return extractCoords(geometry.features[0])
  return []
}

function findFieldForPoint(lat: number, lon: number, fields: { id: string; boundary: any }[]): string | null {
  for (const field of fields) {
    const coords = extractCoords(field.boundary)
    if (coords.length > 0 && pointInPolygon(lat, lon, coords)) {
      return field.id
    }
  }
  return null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const hoursBack = parseInt(searchParams.get('hours') || '24')
    const machineFilter = searchParams.get('machine')

    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    const { data: dbFields } = await supabase
      .from('fields')
      .select('id, name, boundary')
      .not('boundary', 'is', null)

    const fields = (dbFields || []).filter(f => f.boundary)

    const machineRes = await fetch(
      `https://api.deere.com/isg/equipment?organizationIds=${ORG_ID}`,
      { headers }
    )
    const machineData = await machineRes.json()
    const allMachines = machineData.values || []

    const relevantMachines = allMachines.filter((m: any) => {
      if (machineFilter) return m.id === machineFilter
      return m.telematicsCapable && !m.archived && RELEVANT_TYPES.has(m.type?.name || '')
    })

    for (const m of relevantMachines) {
      await supabase.from('machines').upsert({
        id: m.id,
        name: m.name,
        make: m.make?.name || null,
        model: m.model?.name || null,
        type: m.type?.name || null,
        serial_number: m.serialNumber || null,
        telematics_capable: m.telematicsCapable || false,
        archived: m.archived || false,
      }, { onConflict: 'id' })
    }

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()
    const until = new Date().toISOString()

    let totalSessions = 0
    let processed = 0
    const machineDetails: { id: string; name: string; pings: number; sessions: number }[] = []

    for (const machine of relevantMachines) {
      const machineId = machine.id

      // Fetch ALL location history pages
      let allLocations: { lat: number; lon: number; ts: string }[] = []
      let locUrl: string = `${JD_BASE}/machines/${machineId}/locationHistory?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(until)}&itemLimit=100`

      while (locUrl) {
        const locRes = await fetch(locUrl, { headers })
        if (!locRes.ok) { locUrl = ''; break }

        const locData = await locRes.json()
        const batch = (locData.values || [])
          .filter((l: any) => l.point?.lat && l.point?.lon)
          .map((l: any) => ({
            lat: l.point.lat,
            lon: l.point.lon,
            ts: l.eventTimestamp || l.gpsFixTimestamp
          }))

        allLocations = allLocations.concat(batch)

        const nextLink = locData.links?.find((l: any) => l.rel === 'nextPage')
        locUrl = nextLink?.uri || ''

        await new Promise(r => setTimeout(r, 100))
      }

      const locations = allLocations.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      if (locations.length === 0) {
        machineDetails.push({ id: machineId, name: machine.name, pings: 0, sessions: 0 })
        continue
      }

      const lastLoc = locations[locations.length - 1]
      await supabase.from('machines').update({
        last_seen_at: lastLoc.ts,
        last_lat: lastLoc.lat,
        last_lon: lastLoc.lon
      }).eq('id', machineId)

      let currentFieldId: string | null = null
      let sessionStart: string | null = null
      let lastTs: string | null = null
      let machineSessions = 0

      for (const loc of locations) {
        const fieldId = findFieldForPoint(loc.lat, loc.lon, fields)

        if (fieldId !== currentFieldId) {
          if (currentFieldId && sessionStart && lastTs) {
            const durationMs = new Date(lastTs).getTime() - new Date(sessionStart).getTime()
            const durationMinutes = Math.round(durationMs / 60000)
            if (durationMinutes >= 2) {
              const { error } = await supabase.from('machine_field_sessions').upsert({
                machine_id: machineId,
                field_id: currentFieldId,
                entered_at: sessionStart,
                exited_at: lastTs,
                duration_minutes: durationMinutes,
                date: sessionStart.split('T')[0]
              }, { onConflict: 'machine_id,field_id,entered_at' })
              if (!error) { totalSessions++; machineSessions++ }
            }
          }
          currentFieldId = fieldId
          sessionStart = fieldId ? loc.ts : null
        }
        lastTs = loc.ts
      }

      if (currentFieldId && sessionStart && lastTs) {
        const durationMs = new Date(lastTs).getTime() - new Date(sessionStart).getTime()
        const durationMinutes = Math.round(durationMs / 60000)
        if (durationMinutes >= 2) {
          const { error } = await supabase.from('machine_field_sessions').upsert({
            machine_id: machineId,
            field_id: currentFieldId,
            entered_at: sessionStart,
            exited_at: lastTs,
            duration_minutes: durationMinutes,
            date: sessionStart.split('T')[0]
          }, { onConflict: 'machine_id,field_id,entered_at' })
          if (!error) { totalSessions++; machineSessions++ }
        }
      }

      machineDetails.push({ id: machineId, name: machine.name, pings: locations.length, sessions: machineSessions })
      processed++
      await new Promise(r => setTimeout(r, 200))
    }

    return NextResponse.json({
      success: true,
      machines_synced: relevantMachines.length,
      machines_processed: processed,
      sessions_created: totalSessions,
      hours_back: hoursBack,
      since,
      until,
      details: machineDetails
    })

  } catch (err) {
    console.error('Machine sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
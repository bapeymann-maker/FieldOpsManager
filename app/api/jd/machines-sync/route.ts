import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
const ORG_ID = '464281'

const RELEVANT_TYPES = new Set([
  'Track Tractor',
  'Wheel Tractor',
  'Tractor',
  'Combine',
  'Sprayer',
  'Planter',
  'Two-wheel Drive Tractors - 140 Hp And Above',
  'Four-wheel Drive Tractor',
])

const MACHINE_ROLES: Record<string, string> = {
  '5400560': 'tillage',  // 9RT 570 #20 UFER
  '6274249': 'tillage',  // 9620RX #21 UFER
  '1151167': 'seeding',  // 8RT 370 #1 Ufer
  '4844531': 'seeding',  // 8RT 370 #3 Ufer
}

const ENGINE_OFF_SPLIT_MINUTES = 60

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
    if (coords.length > 0 && pointInPolygon(lat, lon, coords)) return field.id
  }
  return null
}

// Find continuous engine-off periods > threshold and return split point timestamps
function getEngineOffSplits(
  stateReports: { time: string; engineState: number }[],
  sinceTs: string,
  untilTs: string
): string[] {
  if (stateReports.length === 0) return []

  const sinceMs = new Date(sinceTs).getTime()
  const untilMs = new Date(untilTs).getTime()

  const reports = stateReports
    .filter(r => {
      const t = new Date(r.time).getTime()
      return t >= sinceMs && t <= untilMs
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  const splits: string[] = []
  let engineOffStart: string | null = null

  for (const r of reports) {
    if (r.engineState === 0) {
      if (!engineOffStart) engineOffStart = r.time
    } else {
      if (engineOffStart) {
        const offMs = new Date(r.time).getTime() - new Date(engineOffStart).getTime()
        const offMinutes = offMs / 60000
        if (offMinutes >= ENGINE_OFF_SPLIT_MINUTES) {
          // Use the engine-off start time as the split point, not the midpoint
splits.push(engineOffStart)
        }
        engineOffStart = null
      }
    }
  }

  return splits
}

const opTypeCache: Record<string, string | null> = {}

async function getOperationTypeForFieldDate(
  fieldId: string,
  date: string,
  machineType?: string,
  machineId?: string
): Promise<string | null> {
  const cacheKey = `${fieldId}_${date}_${machineType || ''}_${machineId || ''}`
  if (cacheKey in opTypeCache) return opTypeCache[cacheKey]

  const { data } = await supabase
    .from('operations')
    .select('operation_types(name)')
    .eq('field_id', fieldId)
    .eq('date', date)
    .order('date', { ascending: false })

  let ops = (data || []).map((op: any) => op.operation_types?.name).filter(Boolean) as string[]

  // Check previous day for overnight operations
  if (ops.length === 0) {
    const prevDate = new Date(date + 'T12:00:00Z')
    prevDate.setDate(prevDate.getDate() - 1)
    const prevDateStr = prevDate.toISOString().split('T')[0]
    const { data: prevData } = await supabase
      .from('operations')
      .select('operation_types(name)')
      .eq('field_id', fieldId)
      .eq('date', prevDateStr)
      .order('date', { ascending: false })
    ops = (prevData || []).map((op: any) => op.operation_types?.name).filter(Boolean) as string[]
  }

  let opType: string | null = null

  if (machineId && MACHINE_ROLES[machineId]) {
    const role = MACHINE_ROLES[machineId]
    if (role === 'tillage') {
      opType = ops.find(n => n.startsWith('Tillage')) ||
               ops.find(n => n.startsWith('Application')) ||
               ops[0] || null
    } else if (role === 'seeding') {
      opType = ops.find(n => n === 'Seeding') || ops[0] || null
    }
    opTypeCache[cacheKey] = opType
    return opType
  }

  const isPlanter = machineType === 'Planter'
  const isCombine = machineType === 'Combine'
  const isTrackTractor = machineType === 'Track Tractor'
  const isWheelTractor = machineType === 'Wheel Tractor' ||
    machineType === 'Two-wheel Drive Tractors - 140 Hp And Above' ||
    machineType === 'Four-wheel Drive Tractor' ||
    machineType === 'Tractor'

  const hasSeeding = ops.includes('Seeding')
  const hasHarvest = ops.includes('Harvest')
  const hasTillage = ops.some(n => n.startsWith('Tillage'))
  const hasApplication = ops.some(n => n.startsWith('Application'))

  if (isPlanter) {
    opType = ops.find(n => n === 'Seeding') || ops[0] || null
  } else if (isCombine) {
    opType = ops.find(n => n === 'Harvest') || ops[0] || null
  } else if (isTrackTractor) {
    if (hasSeeding) opType = 'Seeding'
    else if (hasTillage) opType = ops.find(n => n.startsWith('Tillage')) || null
    else if (hasHarvest) opType = 'Harvest'
    else if (hasApplication) opType = ops.find(n => n.startsWith('Application')) || null
    else opType = ops[0] || null
  } else if (isWheelTractor) {
    if (hasTillage && hasSeeding) opType = ops.find(n => n.startsWith('Tillage')) || null
    else if (hasSeeding) opType = 'Seeding'
    else if (hasTillage) opType = ops.find(n => n.startsWith('Tillage')) || null
    else if (hasHarvest) opType = 'Harvest'
    else if (hasApplication) opType = ops.find(n => n.startsWith('Application')) || null
    else opType = ops[0] || null
  } else {
    opType = ops.find(n => n === 'Seeding') ||
      ops.find(n => n === 'Harvest') ||
      ops.find(n => n.startsWith('Tillage')) ||
      ops.find(n => n.startsWith('Application')) ||
      ops[0] || null
  }

  opTypeCache[cacheKey] = opType
  return opType
}

async function saveSession(
  machineId: string,
  fieldId: string,
  sessionStart: string,
  sessionEnd: string,
  machineType: string,
  totalSessions: { count: number }
) {
  const durationMs = new Date(sessionEnd).getTime() - new Date(sessionStart).getTime()
  const durationMinutes = Math.round(durationMs / 60000)
  if (durationMinutes < 2) return

  const sessionDate = sessionStart.split('T')[0]
  const opType = await getOperationTypeForFieldDate(fieldId, sessionDate, machineType, machineId)

  const { error } = await supabase.from('machine_field_sessions').upsert({
    machine_id: machineId,
    field_id: fieldId,
    entered_at: sessionStart,
    exited_at: sessionEnd,
    duration_minutes: durationMinutes,
    operation_type: opType,
    date: sessionDate
  }, { onConflict: 'machine_id,field_id,entered_at' })

  if (!error) totalSessions.count++
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

    const relevantMachines = allMachines
      .filter((m: any) => {
        if (machineFilter) return m.id === machineFilter
        return m.telematicsCapable && !m.archived && RELEVANT_TYPES.has(m.type?.name || '')
      })
      .map((m: any) => ({ ...m, platformId: m.principalId || m.id }))

    for (const m of relevantMachines) {
      await supabase.from('machines').upsert({
        id: m.id, name: m.name, make: m.make?.name || null,
        model: m.model?.name || null, type: m.type?.name || null,
        serial_number: m.serialNumber || null,
        telematics_capable: m.telematicsCapable || false,
        archived: m.archived || false,
      }, { onConflict: 'id' })
    }

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()
    const until = new Date().toISOString()

    const totalSessions = { count: 0 }
    let processed = 0
    const machineDetails: { id: string; name: string; platformId: string; pings: number; sessions: number; stateReports: number }[] = []

    for (const machine of relevantMachines) {
      const machineId = machine.id
      const platformId = machine.platformId
      const machineType = machine.type?.name || ''

      // Fetch location history (paginated)
      let allLocations: { lat: number; lon: number; ts: string }[] = []
      let locUrl: string = `${JD_BASE}/machines/${platformId}/locationHistory?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(until)}&itemLimit=100`

      while (locUrl) {
        const locRes = await fetch(locUrl, { headers })
        if (!locRes.ok) { locUrl = ''; break }
        const locData = await locRes.json()
        const batch = (locData.values || [])
          .filter((l: any) => l.point?.lat && l.point?.lon)
          .map((l: any) => ({ lat: l.point.lat, lon: l.point.lon, ts: l.eventTimestamp || l.gpsFixTimestamp }))
        allLocations = allLocations.concat(batch)
        const nextLink = locData.links?.find((l: any) => l.rel === 'nextPage')
        locUrl = nextLink?.uri || ''
        await new Promise(r => setTimeout(r, 100))
      }

      const locations = allLocations.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      if (locations.length === 0) {
        machineDetails.push({ id: machineId, name: machine.name, platformId, pings: 0, sessions: 0, stateReports: 0 })
        continue
      }

      // Fetch device state reports in 7-day chunks to avoid 250-record cap
      let stateReports: { time: string; engineState: number }[] = []
      const sinceDate = new Date(since)
      const untilDate = new Date(until)
      let chunkStart = new Date(sinceDate)

      while (chunkStart < untilDate) {
        const chunkEnd = new Date(Math.min(
          chunkStart.getTime() + 7 * 24 * 60 * 60 * 1000,
          untilDate.getTime()
        ))

        let stateUrl: string = `${JD_BASE}/machines/${platformId}/deviceStateReports?startDate=${encodeURIComponent(chunkStart.toISOString())}&endDate=${encodeURIComponent(chunkEnd.toISOString())}&itemLimit=100`

        while (stateUrl) {
          const stateRes = await fetch(stateUrl, { headers })
          if (!stateRes.ok) { stateUrl = ''; break }
          const stateData = await stateRes.json()
          const batch = (stateData.values || [])
            .filter((r: any) => r.time != null)
            .map((r: any) => ({ time: r.time, engineState: r.engineState ?? 1 }))
          stateReports = stateReports.concat(batch)
          const nextLink = stateData.links?.find((l: any) => l.rel === 'nextPage')
          stateUrl = nextLink?.uri || ''
          await new Promise(r => setTimeout(r, 100))
        }

        chunkStart = chunkEnd
        await new Promise(r => setTimeout(r, 150))
      }

      // Update machine last seen
      const lastLoc = locations[locations.length - 1]
      await supabase.from('machines').update({
        last_seen_at: lastLoc.ts, last_lat: lastLoc.lat, last_lon: lastLoc.lon
      }).eq('id', machineId)

      // Get engine-off split points across the full window
      const splitPoints = getEngineOffSplits(stateReports, since, until)

      // Build field sessions, splitting on field boundary transitions and engine-off periods
      let currentFieldId: string | null = null
      let sessionStart: string | null = null
      let lastTs: string | null = null
      const sessionsBefore = totalSessions.count

      for (const loc of locations) {
        const fieldId = findFieldForPoint(loc.lat, loc.lon, fields)

        // Check if we cross an engine-off split point between last ping and this ping
        if (sessionStart && lastTs && currentFieldId && splitPoints.length > 0) {
          for (const split of splitPoints) {
            if (split > lastTs && split <= loc.ts) {
              await saveSession(machineId, currentFieldId, sessionStart, split, machineType, totalSessions)
              sessionStart = loc.ts
              break
            }
          }
        }

        if (fieldId !== currentFieldId) {
          if (currentFieldId && sessionStart && lastTs) {
            await saveSession(machineId, currentFieldId, sessionStart, lastTs, machineType, totalSessions)
          }
          currentFieldId = fieldId
          sessionStart = fieldId ? loc.ts : null
        }

        lastTs = loc.ts
      }

      // Save last open session
      if (currentFieldId && sessionStart && lastTs) {
        await saveSession(machineId, currentFieldId, sessionStart, lastTs, machineType, totalSessions)
      }

      const sessionsCreated = totalSessions.count - sessionsBefore
      machineDetails.push({ id: machineId, name: machine.name, platformId, pings: locations.length, sessions: sessionsCreated, stateReports: stateReports.length })
      processed++
      await new Promise(r => setTimeout(r, 200))
    }

    return NextResponse.json({
      success: true,
      machines_synced: relevantMachines.length,
      machines_processed: processed,
      sessions_created: totalSessions.count,
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
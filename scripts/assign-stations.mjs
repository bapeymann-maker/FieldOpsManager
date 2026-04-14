import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

function getFirstCoordinate(boundary) {
  try {
    if (boundary.type === 'Polygon') {
      return boundary.coordinates[0][0]
    } else if (boundary.type === 'MultiPolygon') {
      return boundary.coordinates[0][0][0]
    } else if (boundary.type === 'Feature') {
      return getFirstCoordinate(boundary.geometry)
    } else if (boundary.type === 'FeatureCollection') {
      return getFirstCoordinate(boundary.features[0])
    }
  } catch (e) {
    return null
  }
  return null
}

async function getNearestStation(lat, lng) {
  const url = `https://api.weather.gov/points/${lat},${lng}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FieldOpsManager/1.0 (johnufer@yahoo.com)' }
  })
  if (!res.ok) {
    console.log(`  NOAA points failed: ${res.status}`)
    return null
  }
  const data = await res.json()
  const stationsUrl = data.properties?.observationStations
  if (!stationsUrl) return null

  const stationsRes = await fetch(stationsUrl, {
    headers: { 'User-Agent': 'FieldOpsManager/1.0 (johnufer@yahoo.com)' }
  })
  if (!stationsRes.ok) return null
  const stationsData = await stationsRes.json()
  const station = stationsData.features?.[0]
  if (!station) return null

  const sLng = station.geometry.coordinates[0]
  const sLat = station.geometry.coordinates[1]
  const distMiles = Math.sqrt(Math.pow((lat - sLat) * 69, 2) + Math.pow((lng - sLng) * 53, 2))

  return {
    id: station.properties.stationIdentifier,
    name: station.properties.name,
    lat: sLat,
    lng: sLng,
    distMiles: Math.round(distMiles * 10) / 10
  }
}

async function main() {
  console.log('Fetching fields with boundaries...')
  const { data: fields } = await supabase
    .from('fields')
    .select('id, name, boundary')
    .not('boundary', 'is', null)

  console.log(`Found ${fields.length} fields with boundaries\n`)

  let assigned = 0
  let failed = 0

  for (const field of fields) {
    const coord = getFirstCoordinate(field.boundary)
    if (!coord) {
      console.log(`  SKIP ${field.name} — could not extract coordinate`)
      failed++
      continue
    }

    const [lng, lat] = coord
    console.log(`Processing ${field.name} (${lat.toFixed(4)}, ${lng.toFixed(4)})...`)

    const station = await getNearestStation(lat, lng)
    if (!station) {
      console.log(`  FAIL — no station found`)
      failed++
      continue
    }

    const { error } = await supabase.from('field_stations').upsert({
      field_id: field.id,
      station_id: station.id,
      station_name: station.name,
      distance_miles: station.distMiles
    }, { onConflict: 'field_id' })

    if (error) {
      console.log(`  ERROR saving: ${error.message}`)
      failed++
    } else {
      console.log(`  → ${station.id} (${station.name}) ${station.distMiles} miles`)
      assigned++
    }

    // Respect NOAA rate limits
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\nDone — ${assigned} assigned, ${failed} failed`)
}

main()
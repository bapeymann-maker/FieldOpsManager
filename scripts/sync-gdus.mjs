import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

const CROP_CONFIGS = {
  CORN_WET:   { base: 50, max: 86, name: 'corn' },
  CORN:       { base: 50, max: 86, name: 'corn' },
  SOYBEAN:    { base: 50, max: 86, name: 'soybean' },
  SOYBEANS:   { base: 50, max: 86, name: 'soybean' },
  OATS:       { base: 40, max: 99, name: 'oats' },
  OAT:        { base: 40, max: 99, name: 'oats' },
  PEAS:       { base: 40, max: 99, name: 'peas' },
  PEA:        { base: 40, max: 99, name: 'peas' },
  SWEET_CORN: { base: 50, max: 86, name: 'sweet_corn' },
  SWEETCORN:  { base: 50, max: 86, name: 'sweet_corn' },
}

function calcGDU(maxF, minF, base, maxCap) {
  const hi = Math.min(maxF, maxCap)
  const lo = Math.max(minF, base)
  return Math.max(0, (hi + lo) / 2 - base)
}

function parseArgs() {
  const args = process.argv.slice(2)
  let start = null, end = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) start = args[i + 1]
    if (args[i] === '--end' && args[i + 1]) end = args[i + 1]
  }
  return { start, end }
}

function getDateRange(startStr, endStr) {
  const dates = []
  const cur = new Date(startStr + 'T12:00:00Z')
  const last = new Date(endStr + 'T12:00:00Z')
  while (cur <= last) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// Calculate centroid from GeoJSON boundary
function getCentroid(boundary) {
  try {
    const geo = typeof boundary === 'string' ? JSON.parse(boundary) : boundary
    let coords = null
    if (geo.type === 'Polygon') coords = geo.coordinates[0]
    else if (geo.type === 'MultiPolygon') coords = geo.coordinates[0][0]
    else if (geo.type === 'Feature') return getCentroid(geo.geometry)
    else if (geo.type === 'FeatureCollection') return getCentroid(geo.features?.[0])
    if (!coords || coords.length === 0) return null
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
    const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
    return { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 }
  } catch (e) { return null }
}

// Always use Open-Meteo with field coordinates for accurate localized rainfall
async function getWeatherForCoords(lat, lon, date) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FChicago`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'FieldOpsManager/1.0 (johnufer@yahoo.com)' } })
    if (!res.ok) return null
    const data = await res.json()
    const maxF = data.daily?.temperature_2m_max?.[0]
    const minF = data.daily?.temperature_2m_min?.[0]
    const rain = data.daily?.precipitation_sum?.[0]
    if (maxF == null || minF == null) return null
    return {
      maxF,
      minF,
      rainfallInches: Math.round((rain || 0) * 100) / 100
    }
  } catch (e) { return null }
}

// Cache by rounded coords to avoid duplicate API calls for nearby fields (~1km grid)
function coordKey(lat, lon) {
  return `${Math.round(lat * 100) / 100}_${Math.round(lon * 100) / 100}`
}

async function main() {
  const { start, end } = parseArgs()

  let dates
  if (start && end) {
    dates = getDateRange(start, end)
    console.log(`Backfilling ${dates.length} days: ${start} → ${end}\n`)
  } else if (start) {
    dates = [start]
    console.log(`Syncing single date: ${start}\n`)
  } else {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    dates = [yesterday.toISOString().split('T')[0]]
    console.log(`Syncing GDUs for ${dates[0]}\n`)
  }

  // Load fields with boundaries to compute centroids
  const { data: fieldsWithBoundary } = await supabase
    .from('fields')
    .select('id, name, boundary')
    .not('boundary', 'is', null)

  if (!fieldsWithBoundary?.length) { console.log('No fields with boundaries found'); return }

  const fieldCentroids = {}
  for (const f of fieldsWithBoundary) {
    const centroid = getCentroid(f.boundary)
    if (centroid) fieldCentroids[f.id] = centroid
  }
  console.log(`Computed centroids for ${Object.keys(fieldCentroids).length} fields`)

  // Load field stations — still used to know which fields to process
  const { data: fieldStations } = await supabase
    .from('field_stations')
    .select('field_id, station_id, station_name')

  if (!fieldStations?.length) { console.log('No field stations found'); return }
  console.log(`Found ${fieldStations.length} field-station assignments`)

  // Load operation type IDs
  const { data: seedingType } = await supabase.from('operation_types').select('id').eq('name', 'Seeding').single()
  const { data: harvestType } = await supabase.from('operation_types').select('id').eq('name', 'Harvest').single()

  // Load all seeding ops
  const { data: seedingOps } = await supabase
    .from('operations')
    .select('field_id, date, crop_type, notes')
    .eq('operation_type_id', seedingType.id)
    .eq('hidden', false)
    .order('date', { ascending: true })

  console.log(`Found ${seedingOps?.length || 0} seeding operations total`)

  const seedingsByField = {}
  for (const op of seedingOps || []) {
    if (!seedingsByField[op.field_id]) seedingsByField[op.field_id] = []
    seedingsByField[op.field_id].push({ date: op.date, crop_type: op.crop_type || op.notes || 'CORN' })
  }

  // Load harvest ops
  const { data: harvestOps } = await supabase
    .from('operations')
    .select('field_id, date')
    .eq('operation_type_id', harvestType.id)
    .order('date', { ascending: true })

  const harvestsByField = {}
  for (const op of harvestOps || []) {
    if (!harvestsByField[op.field_id]) harvestsByField[op.field_id] = []
    harvestsByField[op.field_id].push(op.date)
  }

  function getActiveSeedingOnDate(fieldId, dateStr) {
    const seedings = seedingsByField[fieldId] || []
    const candidates = seedings.filter(s => s.date <= dateStr).sort((a, b) => b.date.localeCompare(a.date))
    for (const seeding of candidates) {
      const harvests = (harvestsByField[fieldId] || []).filter(h => h > seeding.date && h <= dateStr)
      if (harvests.length === 0) return seeding
    }
    return null
  }

  // Load existing GDU records for cumulative calculations
  console.log('Loading existing GDU records...')
  const { data: existingRecords } = await supabase
    .from('gdu_daily')
    .select('field_id, date, daily_gdu, rainfall_inches')
    .order('date', { ascending: true })

  const fieldHistory = {}
  for (const r of existingRecords || []) {
    if (!fieldHistory[r.field_id]) fieldHistory[r.field_id] = []
    fieldHistory[r.field_id].push(r)
  }
  console.log(`Loaded ${existingRecords?.length || 0} existing records\n`)

  let totalSynced = 0, totalSkipped = 0, totalNoWeather = 0

  for (const dateStr of dates) {
    const weatherCache = {}
    let daySynced = 0

    for (const fs of fieldStations) {
      const seeding = getActiveSeedingOnDate(fs.field_id, dateStr)
      if (!seeding) { totalSkipped++; continue }

      const cropKey = (seeding.crop_type || 'CORN').toUpperCase().replace(/ /g, '_')
      const cropConfig = CROP_CONFIGS[cropKey] || CROP_CONFIGS['CORN']

      const centroid = fieldCentroids[fs.field_id]
      if (!centroid) { totalNoWeather++; continue }

      const cKey = coordKey(centroid.lat, centroid.lon)
      if (!(cKey in weatherCache)) {
        weatherCache[cKey] = await getWeatherForCoords(centroid.lat, centroid.lon, dateStr)
        await new Promise(r => setTimeout(r, 120))
      }

      const obs = weatherCache[cKey]
      if (!obs) { totalNoWeather++; continue }

      const dailyGDU = Math.round(calcGDU(obs.maxF, obs.minF, cropConfig.base, cropConfig.max) * 10) / 10
      const rainfallInches = obs.rainfallInches || 0

      const history = fieldHistory[fs.field_id] || []
      const prior = history.filter(r => r.date >= seeding.date && r.date < dateStr)
      const cumulativeGDU = Math.round((prior.reduce((s, r) => s + (r.daily_gdu || 0), 0) + dailyGDU) * 10) / 10
      const cumulativeRainfall = Math.round((prior.reduce((s, r) => s + (r.rainfall_inches || 0), 0) + rainfallInches) * 100) / 100

      const { error } = await supabase.from('gdu_daily').upsert({
        field_id: fs.field_id,
        date: dateStr,
        station_id: `${centroid.lat},${centroid.lon}`,
        max_temp: Math.round(obs.maxF * 10) / 10,
        min_temp: Math.round(obs.minF * 10) / 10,
        daily_gdu: dailyGDU,
        rainfall_inches: rainfallInches,
        cumulative_gdu: cumulativeGDU,
        cumulative_rainfall: cumulativeRainfall,
        crop_type: cropConfig.name
      }, { onConflict: 'field_id,date' })

      if (error) {
        console.log(`\n  ERROR ${fs.field_id}: ${error.message}`)
        totalSkipped++
      } else {
        const existing = fieldHistory[fs.field_id]?.find(r => r.date === dateStr)
        if (existing) {
          existing.daily_gdu = dailyGDU
          existing.rainfall_inches = rainfallInches
        } else {
          if (!fieldHistory[fs.field_id]) fieldHistory[fs.field_id] = []
          fieldHistory[fs.field_id].push({ date: dateStr, daily_gdu: dailyGDU, rainfall_inches: rainfallInches })
          fieldHistory[fs.field_id].sort((a, b) => a.date.localeCompare(b.date))
        }
        daySynced++
        totalSynced++
      }
    }

    process.stdout.write(`\n[${dateStr}] ${daySynced} records`)
  }

  console.log(`\n\nDone — ${totalSynced} synced, ${totalSkipped} skipped (no seeding), ${totalNoWeather} no weather data`)
}

main()

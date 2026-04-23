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

function celsiusToF(c) { return c * 9 / 5 + 32 }

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
// Station coordinates for Open-Meteo fallback
const STATION_COORDS = {
  KJYG: { lat: 43.982, lon: -94.559 },
  KFRM: { lat: 43.645, lon: -94.416 },
  KOVL: { lat: 44.777, lon: -94.981 },
  KRWF: { lat: 44.547, lon: -95.082 },
  KMJQ: { lat: 43.649, lon: -94.990 },
  KBDH: { lat: 45.117, lon: -95.117 },
  KHCD: { lat: 44.857, lon: -94.382 },
  KMWM: { lat: 43.914, lon: -95.109 },
}

async function getObservation(stationId, date) {
  // Use Open-Meteo for historical data (more than 7 days old)
  const dateDiff = (new Date() - new Date(date + 'T12:00:00Z')) / (1000 * 60 * 60 * 24)
  
  if (dateDiff > 7) {
    const coords = STATION_COORDS[stationId]
    if (!coords) return null
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.lat}&longitude=${coords.lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FChicago`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'FieldOpsManager/1.0' } })
      if (!res.ok) return null
      const data = await res.json()
      const maxF = data.daily?.temperature_2m_max?.[0]
      const minF = data.daily?.temperature_2m_min?.[0]
      const rain = data.daily?.precipitation_sum?.[0]
      if (maxF == null || minF == null) return null
      return { maxF, minF, rainfallInches: Math.round((rain || 0) * 100) / 100 }
    } catch (e) { return null }
  }

  // Use NOAA for recent data
  const url = `https://api.weather.gov/stations/${stationId}/observations?start=${date}T00:00:00Z&end=${date}T23:59:59Z&limit=100`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'FieldOpsManager/1.0 (johnufer@yahoo.com)' } })
    if (!res.ok) return null
    const data = await res.json()
    const obs = data.features || []
    if (obs.length === 0) return null
    const temps = obs.map(o => o.properties?.temperature?.value).filter(v => v != null).map(celsiusToF)
    if (temps.length === 0) return null
    const totalRainMM = obs.reduce((sum, o) => {
      const p = o.properties?.precipitationLastHour?.value
      return sum + (p != null ? p : 0)
    }, 0)
    return {
      maxF: Math.max(...temps),
      minF: Math.min(...temps),
      rainfallInches: Math.round((totalRainMM / 25.4) * 100) / 100
    }
  } catch (e) { return null }
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

  // Load field stations
  const { data: fieldStations } = await supabase.from('field_stations').select('field_id, station_id, station_name')
  if (!fieldStations?.length) { console.log('No field stations found'); return }
  console.log(`Found ${fieldStations.length} field-station assignments`)

  // Load operation type IDs
  const { data: seedingType } = await supabase.from('operation_types').select('id').eq('name', 'Seeding').single()
  const { data: harvestType } = await supabase.from('operation_types').select('id').eq('name', 'Harvest').single()

  // Load ALL seeding ops (not just most recent) so we can find 2025 seedings
  const { data: seedingOps } = await supabase
    .from('operations')
    .select('field_id, date, crop_type, notes')
    .eq('operation_type_id', seedingType.id)
    .eq('hidden', false)
    .order('date', { ascending: true })

  console.log(`Found ${seedingOps?.length || 0} seeding operations total`)

  // Group all seedings by field
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

  // Group harvests by field
  const harvestsByField = {}
  for (const op of harvestOps || []) {
    if (!harvestsByField[op.field_id]) harvestsByField[op.field_id] = []
    harvestsByField[op.field_id].push(op.date)
  }

  // Find which seeding was active on a given date
  // (most recent seeding on or before that date, not yet harvested)
  function getActiveSeedingOnDate(fieldId, dateStr) {
    const seedings = seedingsByField[fieldId] || []
    // Get all seedings on or before this date, most recent first
    const candidates = seedings.filter(s => s.date <= dateStr).sort((a, b) => b.date.localeCompare(a.date))
    for (const seeding of candidates) {
      // Check if this seeding was harvested before the target date
      const harvests = (harvestsByField[fieldId] || []).filter(h => h > seeding.date && h <= dateStr)
      if (harvests.length === 0) return seeding // not yet harvested on this date
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

  // Debug: test first date to see what's happening
  const testDate = dates[0]
  const testStation = fieldStations[0]?.station_id
  if (testStation) {
    process.stdout.write(`DEBUG: Testing station ${testStation} on ${testDate}... `)
    const testObs = await getObservation(testStation, testDate)
    console.log(testObs ? `Got data: ${testObs.maxF.toFixed(1)}°F max, ${testObs.minF.toFixed(1)}°F min` : 'NO DATA from NOAA')
  }

  // Debug: check seedings for first field
  const firstField = fieldStations[0]?.field_id
  if (firstField) {
    const activeSeeding = getActiveSeedingOnDate(firstField, testDate)
    console.log(`DEBUG: Active seeding for first field on ${testDate}: ${activeSeeding ? activeSeeding.date : 'NONE'}\n`)
  }

  let totalSynced = 0, totalSkipped = 0, totalNoWeather = 0

  for (const dateStr of dates) {
    const stationCache = {}
    let daySynced = 0

    for (const fs of fieldStations) {
      const seeding = getActiveSeedingOnDate(fs.field_id, dateStr)
      if (!seeding) { totalSkipped++; continue }

      const cropKey = (seeding.crop_type || 'CORN').toUpperCase().replace(/ /g, '_')
      const cropConfig = CROP_CONFIGS[cropKey] || CROP_CONFIGS['CORN']

      if (!(fs.station_id in stationCache)) {
        stationCache[fs.station_id] = await getObservation(fs.station_id, dateStr)
        await new Promise(r => setTimeout(r, 150))
      }

      const obs = stationCache[fs.station_id]
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
        station_id: fs.station_id,
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

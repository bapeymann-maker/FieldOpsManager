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
  const avg = (hi + lo) / 2
  return Math.max(0, avg - base)
}

function celsiusToF(c) {
  return c * 9 / 5 + 32
}

function mmToInches(mm) {
  return Math.round((mm / 25.4) * 100) / 100
}

async function getObservation(stationId, date) {
  const start = `${date}T00:00:00Z`
  const end = `${date}T23:59:59Z`
  const url = `https://api.weather.gov/stations/${stationId}/observations?start=${start}&end=${end}&limit=100`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'FieldOpsManager/1.0 (johnufer@yahoo.com)' }
  })

  if (!res.ok) {
    console.log(`  NOAA fetch failed for ${stationId}: ${res.status}`)
    return null
  }

  const data = await res.json()
  const obs = data.features || []
  if (obs.length === 0) {
    console.log(`  No observations for ${stationId} on ${date}`)
    return null
  }

  const temps = obs
    .map(o => o.properties?.temperature?.value)
    .filter(v => v !== null && v !== undefined)
    .map(celsiusToF)

  if (temps.length === 0) {
    console.log(`  No temperature data for ${stationId}`)
    return null
  }

  let totalRainMM = 0
  for (const o of obs) {
    const p1 = o.properties?.precipitationLastHour?.value
    if (p1 != null && p1 > 0) totalRainMM += p1
  }

  if (totalRainMM === 0) {
    for (const o of obs) {
      const p6 = o.properties?.precipitationLast6Hours?.value
      if (p6 != null && p6 > 0) totalRainMM = Math.max(totalRainMM, p6)
    }
  }

  return {
    maxF: Math.round(Math.max(...temps) * 10) / 10,
    minF: Math.round(Math.min(...temps) * 10) / 10,
    rainfallInches: mmToInches(totalRainMM)
  }
}

async function getCumulatives(fieldId, seedingDate, targetDate) {
  const { data } = await supabase
    .from('gdu_daily')
    .select('daily_gdu, rainfall_inches')
    .eq('field_id', fieldId)
    .gte('date', seedingDate)
    .lt('date', targetDate)

  if (!data || data.length === 0) return { cumulativeGDU: 0, cumulativeRainfall: 0 }

  const cumulativeGDU = data.reduce((sum, r) => sum + (r.daily_gdu || 0), 0)
  const cumulativeRainfall = data.reduce((sum, r) => sum + (r.rainfall_inches || 0), 0)

  return {
    cumulativeGDU: Math.round(cumulativeGDU * 10) / 10,
    cumulativeRainfall: Math.round(cumulativeRainfall * 100) / 100
  }
}

async function main() {
  const arg = process.argv[2]
  let targetDate
  if (arg) {
    targetDate = arg
  } else {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    targetDate = d.toISOString().split('T')[0]
  }
  console.log(`Syncing GDUs and rainfall for ${targetDate}\n`)

  const { data: fieldStations } = await supabase
    .from('field_stations')
    .select('field_id, station_id, station_name')

  if (!fieldStations?.length) {
    console.log('No field stations found — run assign-stations.mjs first')
    return
  }

  const { data: opTypes } = await supabase
    .from('operation_types')
    .select('id, name')

  const seedingTypeId = opTypes.find(o => o.name === 'Seeding')?.id
  const harvestTypeId = opTypes.find(o => o.name === 'Harvest')?.id

  if (!seedingTypeId) {
    console.log('Seeding operation type not found')
    return
  }

  const { data: seedingOps } = await supabase
    .from('operations')
    .select('field_id, date, crop_type, notes')
    .eq('operation_type_id', seedingTypeId)
    .lte('date', targetDate)
    .order('date', { ascending: false })

  const latestSeeding = {}
  for (const op of seedingOps || []) {
    if (!latestSeeding[op.field_id]) {
      latestSeeding[op.field_id] = {
        date: op.date,
        crop_type: op.crop_type || op.notes || 'CORN_WET'
      }
    }
  }

  const { data: harvestOps } = await supabase
    .from('operations')
    .select('field_id, date')
    .eq('operation_type_id', harvestTypeId)
    .order('date', { ascending: false })

  const latestHarvest = {}
  for (const op of harvestOps || []) {
    if (!latestHarvest[op.field_id]) latestHarvest[op.field_id] = op.date
  }

  const stationCache = {}
  let synced = 0
  let skipped = 0
  let noData = 0

  for (const fs of fieldStations) {
    const seeding = latestSeeding[fs.field_id]
    if (!seeding) { skipped++; continue }

    const harvest = latestHarvest[fs.field_id]
    if (harvest && harvest > seeding.date) { skipped++; continue }

    if (seeding.date > targetDate) { skipped++; continue }

    const cropKey = seeding.crop_type?.toUpperCase().replace(/ /g, '_') || 'CORN_WET'
    const cropConfig = CROP_CONFIGS[cropKey] || CROP_CONFIGS['CORN_WET']

    if (!(fs.station_id in stationCache)) {
      console.log(`Fetching ${fs.station_id} (${fs.station_name})...`)
      stationCache[fs.station_id] = await getObservation(fs.station_id, targetDate)
      await new Promise(r => setTimeout(r, 300))
    }

    const obs = stationCache[fs.station_id]
    if (!obs) { noData++; continue }

    const dailyGDU = calcGDU(obs.maxF, obs.minF, cropConfig.base, cropConfig.max)
    const { cumulativeGDU, cumulativeRainfall } = await getCumulatives(fs.field_id, seeding.date, targetDate)

    const totalGDU = Math.round((cumulativeGDU + dailyGDU) * 10) / 10
    const totalRainfall = Math.round((cumulativeRainfall + obs.rainfallInches) * 100) / 100

    const { error } = await supabase.from('gdu_daily').upsert({
      field_id: fs.field_id,
      date: targetDate,
      station_id: fs.station_id,
      max_temp: obs.maxF,
      min_temp: obs.minF,
      daily_gdu: Math.round(dailyGDU * 10) / 10,
      rainfall_inches: obs.rainfallInches,
      cumulative_gdu: totalGDU,
      cumulative_rainfall: totalRainfall,
      crop_type: cropConfig.name
    }, { onConflict: 'field_id,date' })

    if (error) {
      console.log(`  ERROR ${fs.field_id}: ${error.message}`)
      skipped++
    } else {
      console.log(`  ${cropConfig.name} | GDU: ${Math.round(dailyGDU * 10) / 10} (${totalGDU} total) | Rain: ${obs.rainfallInches}" (${totalRainfall}" total)`)
      synced++
    }
  }

  console.log(`\nDone — ${synced} synced, ${skipped} skipped, ${noData} no weather data`)
}

main()
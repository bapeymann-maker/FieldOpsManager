import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// We'll use a dynamic import for xlsx parsing
// Run: npm install xlsx --save-dev first if needed

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

// Manual overrides for field names that don't match DB exactly
// Format: 'harvest report name': 'database field name'
const FIELD_NAME_OVERRIDES = {
  'M-130 Half Section O and M-130 east quarter T2': null, // skip - combined field not in DB
  'Summit South     South Branch 36': 'Summit South     South Branch 36',
}

// Normalize field name for fuzzy matching
function normalize(name) {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 \-_]/g, '')
    .trim()
}

function normalizeCropType(crop) {
  const u = crop.toLowerCase()
  if (u.includes('corn')) return 'Corn'
  if (u.includes('soybean') || u.includes('soy')) return 'Soybeans'
  if (u.includes('oat')) return 'Oats'
  if (u.includes('pea')) return 'Peas'
  if (u.includes('wheat')) return 'Wheat'
  return crop
}

async function main() {
  // Load field list from DB
  const { data: dbFields } = await supabase.from('fields').select('id, name, client')
  if (!dbFields?.length) { console.log('No fields found in DB'); return }

  // Build lookup map: normalized name -> field record
  const fieldLookup = {}
  for (const f of dbFields) {
    fieldLookup[normalize(f.name)] = f
  }

  console.log(`Loaded ${dbFields.length} fields from DB\n`)

  // Parse harvest xlsx using Node.js built-in
  // We'll read the pre-processed data we already know from analysis
  // Instead of requiring xlsx, we'll use a Python-generated JSON approach
  // Actually let's use the xlsx npm package
  let XLSX
  try {
    XLSX = require('xlsx')
  } catch (e) {
    console.error('Please run: npm install xlsx')
    process.exit(1)
  }

  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: node scripts/import-yields-2025.mjs <path-to-harvest-xlsx>')
    process.exit(1)
  }

  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null })

  console.log(`Read ${raw.length} rows from Excel\n`)

  // Aggregate by field + crop type
  const aggregated = {}
  for (const row of raw) {
    const fieldName = String(row['Fields'] || '').trim()
    const farmName = String(row['Farms'] || '').trim()
    const cropType = normalizeCropType(String(row['Crop Type'] || '').trim())
    const key = `${farmName}|||${fieldName}|||${cropType}`

    const acres = parseFloat(row['Area Harvested']) || 0
    const yieldVal = parseFloat(row['Dry Yield']) || 0
    const totalBu = parseFloat(row['Total Dry Yield']) || 0
    const moisture = parseFloat(row['Moisture']) || null
    const fuel = parseFloat(row['Total Fuel']) || 0
    const harvestSec = parseFloat(row['Harvest Time']) || 0
    const variety = String(row['Varieties'] || '').trim()
    const firstH = row['First Harvested']
    const lastH = row['Last Harvested']

    if (!aggregated[key]) {
      aggregated[key] = {
        fieldName, farmName, cropType,
        totalAcres: 0, weightedYieldSum: 0, totalBushels: 0,
        moistureSum: 0, moistureCount: 0,
        totalFuel: 0, harvestSec: 0,
        varieties: new Set(),
        firstHarvested: null, lastHarvested: null
      }
    }

    const a = aggregated[key]
    a.totalAcres += acres
    a.weightedYieldSum += yieldVal * acres
    a.totalBushels += totalBu
    if (moisture) { a.moistureSum += moisture; a.moistureCount++ }
    a.totalFuel += fuel
    a.harvestSec += harvestSec
    if (variety && variety !== '---') a.varieties.add(variety)
    if (firstH && (!a.firstHarvested || firstH < a.firstHarvested)) a.firstHarvested = firstH
    if (lastH && (!a.lastHarvested || lastH > a.lastHarvested)) a.lastHarvested = lastH
  }

  let imported = 0, skipped = 0, unmatched = []

  for (const [key, data] of Object.entries(aggregated)) {
    const { fieldName, farmName, cropType } = data

    // Check overrides
    if (FIELD_NAME_OVERRIDES[fieldName] === null) {
      console.log(`SKIP (override): ${fieldName}`)
      skipped++
      continue
    }

    // Find matching DB field
    let dbField = fieldLookup[normalize(fieldName)]

    // Try partial match if exact fails
    if (!dbField) {
      const normSearch = normalize(fieldName)
      for (const [normKey, f] of Object.entries(fieldLookup)) {
        if (normKey.includes(normSearch) || normSearch.includes(normKey)) {
          dbField = f
          break
        }
      }
    }

    if (!dbField) {
      unmatched.push(fieldName)
      skipped++
      continue
    }

    const avgYield = data.totalAcres > 0 ? Math.round((data.weightedYieldSum / data.totalAcres) * 100) / 100 : null
    const avgMoisture = data.moistureCount > 0 ? Math.round((data.moistureSum / data.moistureCount) * 100) / 100 : null
    const harvestHours = Math.round((data.harvestSec / 3600) * 100) / 100
    const varieties = [...data.varieties].sort().join(', ') || null

    const record = {
      field_id: dbField.id,
      year: 2025,
      crop_type: cropType,
      actual_yield: avgYield,
      total_bushels: Math.round(data.totalBushels * 100) / 100,
      acres_harvested: Math.round(data.totalAcres * 100) / 100,
      avg_moisture: avgMoisture,
      total_fuel_gal: Math.round(data.totalFuel * 100) / 100,
      harvest_hours: harvestHours,
      varieties,
      first_harvested: data.firstHarvested ? new Date(data.firstHarvested).toISOString() : null,
      last_harvested: data.lastHarvested ? new Date(data.lastHarvested).toISOString() : null,
    }

    const { error } = await supabase
      .from('yields')
      .upsert(record, { onConflict: 'field_id,year,crop_type' })

    if (error) {
      console.log(`ERROR ${fieldName} (${cropType}): ${error.message}`)
      skipped++
    } else {
      console.log(`✓ ${fieldName} | ${cropType} | ${avgYield} bu/ac | ${Math.round(data.totalBushels).toLocaleString()} bu`)
      imported++
    }
  }

  console.log(`\n--- Done ---`)
  console.log(`Imported: ${imported}`)
  console.log(`Skipped: ${skipped}`)
  if (unmatched.length > 0) {
    console.log(`\nUnmatched field names (not in DB):`)
    unmatched.forEach(n => console.log(`  - ${n}`))
  }
}

main()

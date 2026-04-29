import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

// Shoelace formula for polygon area in square degrees, then convert to acres
// Uses haversine-based approximation for lat/lon coordinates
function polygonAreaAcres(coords) {
  if (!coords || coords.length < 3) return null

  // Shoelace formula gives area in coordinate units
  // For lat/lon we need to account for the earth's curvature
  const R = 6371000 // Earth radius in meters
  const toRad = d => d * Math.PI / 180

  // Use the surveyor's formula with spherical correction
  let area = 0
  const n = coords.length

  for (let i = 0; i < n - 1; i++) {
    const [lon1, lat1] = coords[i]
    const [lon2, lat2] = coords[i + 1]
    area += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }

  area = Math.abs(area * R * R / 2)
  const acres = area / 4046.8564
  return Math.round(acres * 100) / 100
}

function extractCoords(boundary) {
  if (!boundary) return null
  try {
    const geo = typeof boundary === 'string' ? JSON.parse(boundary) : boundary
    if (geo.type === 'Polygon') return geo.coordinates[0]
    if (geo.type === 'MultiPolygon') return geo.coordinates[0][0]
    if (geo.type === 'Feature') return extractCoords(geo.geometry)
    if (geo.type === 'FeatureCollection') return extractCoords(geo.features?.[0])
  } catch (e) { return null }
  return null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // Get all fields with boundaries
  const { data: fields } = await supabase
    .from('fields')
    .select('id, name, acres, boundary')
    .not('boundary', 'is', null)

if (!fields?.length) { console.log('No fields found', JSON.stringify(fields), 'error:', JSON.stringify(error)); return }

  console.log(`Found ${fields.length} fields with boundaries\n`)

  let updated = 0
  let skipped = 0
  let errors = 0

  for (const field of fields) {
    const coords = extractCoords(field.boundary)
    if (!coords) { errors++; console.log(`  SKIP (no coords): ${field.name}`); continue }

    const calcAcres = polygonAreaAcres(coords)
    if (!calcAcres) { errors++; continue }

    const hasAcres = field.acres !== null && field.acres !== undefined
    const diff = hasAcres ? Math.abs(calcAcres - field.acres) / field.acres : 1

    if (!hasAcres) {
      console.log(`  UPDATE (no acres): ${field.name} → ${calcAcres} ac`)
      if (!dryRun) {
        await supabase.from('fields').update({ acres: calcAcres }).eq('id', field.id)
      }
      updated++
    } else if (diff > 0.15) {
      // Flag large discrepancies (>15% difference) but don't auto-update
      console.log(`  FLAG (big diff): ${field.name} — stored: ${field.acres} ac, calculated: ${calcAcres} ac (${Math.round(diff * 100)}% diff)`)
      skipped++
    } else {
      skipped++
    }
  }

  console.log(`\n--- Done ---`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped (already have acres): ${skipped}`)
  console.log(`Errors: ${errors}`)
  if (dryRun) console.log('\n(Dry run — no changes made. Remove --dry-run to apply)')
}

main()

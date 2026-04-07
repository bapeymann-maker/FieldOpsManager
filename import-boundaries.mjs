import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY3dhZ2h2bHdrY2dxeWFvbnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTY1ODcsImV4cCI6MjA5MTA3MjU4N30.btfhivVtlIxcaEFoSZTVQAJGhSeG5Gutl5OfRd952z8'
)

const geojson = JSON.parse(readFileSync('C:/Users/johnu/Downloads/boundaries.json'))

let updated = 0
let notFound = 0

for (const feature of geojson.features) {
  const name = feature.properties.FIELD_NAME
  const geometry = feature.geometry

  const { data, error } = await supabase
    .from('fields')
    .update({ boundary: geometry })
    .eq('name', name)
    .select()

  if (error) {
    console.log(`ERROR: ${name} - ${error.message}`)
  } else if (data.length === 0) {
    console.log(`NOT FOUND: ${name}`)
    notFound++
  } else {
    console.log(`Updated: ${name}`)
    updated++
  }
}

console.log(`\nDone! Updated: ${updated}, Not found: ${notFound}`)
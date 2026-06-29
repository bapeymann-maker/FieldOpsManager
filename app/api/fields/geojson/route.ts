import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { data, error } = await supabase
    .from('fields')
    .select('id, name, acres, region, client, cert_status, boundary')
    .not('boundary', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const geojson = {
    type: 'FeatureCollection',
    features: (data || []).map(f => ({
      type: 'Feature',
      properties: {
        id: f.id,
        name: f.name,
        acres: f.acres,
        region: f.region,
        client: f.client,
        cert_status: f.cert_status,
      },
      geometry: f.boundary,
    })),
  }

  return NextResponse.json(geojson)
}

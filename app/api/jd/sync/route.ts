import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const JD_BASE = 'https://api.deere.com/platform'
const ORG_ID = '464281'

function mapOperationType(op: {
  fieldOperationType: string
  tillageProducts?: { tillageType: string }[]
  products?: { productType: string }[]
}): string {
  const type = op.fieldOperationType

  if (type === 'seeding') return 'Seeding'
  if (type === 'harvest') return 'Harvest'

  if (type === 'application') {
    const productType = op.products?.[0]?.productType
    if (productType === 'FERTILIZER') return 'Application - Fertilizer'
    return 'Application - Chemical'
  }

  if (type === 'tillage') {
    const tillageType = op.tillageProducts?.[0]?.tillageType?.toLowerCase() || ''
    if (tillageType.includes('row crop') || tillageType.includes('row cultivat')) return 'Tillage - Row Cultivator'
    if (tillageType.includes('disk')) return 'Tillage - Disk'
    if (tillageType.includes('shank')) return 'Tillage - Shank'
    if (tillageType.includes('secondary')) return 'Tillage - Secondary'
    if (tillageType.includes('field cultiv')) return 'Tillage - Field Cultivator'
    if (tillageType.includes('rotary')) return 'Tillage - Rotary Hoe'
    if (tillageType.includes('tine')) return 'Tillage - Tine Weeder'
    return 'Tillage - Field Cultivator'
  }

  return 'Spraying'
}

async function getAccessToken() {
  const { data } = await supabase
    .from('jd_tokens')
    .select('*')
    .eq('id', 1)
    .single()
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

export async function GET() {
  try {
    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    // Get all operation types from Supabase
    const { data: opTypes } = await supabase.from('operation_types').select('*')
    const opTypeMap = Object.fromEntries((opTypes || []).map(ot => [ot.name, ot.id]))

    // Get all fields from Supabase
    const { data: dbFields } = await supabase.from('fields').select('id, name')
    const fieldMap = Object.fromEntries((dbFields || []).map(f => [f.name.toLowerCase().trim(), f.id]))

    // Get all JD fields with pagination
    let allJDFields: {id: string, name: string}[] = []
    let nextUrl = `${JD_BASE}/organizations/${ORG_ID}/fields?itemLimit=100`

    while (nextUrl) {
      const res = await fetch(nextUrl, { headers })
      const data = await res.json()
      allJDFields = allJDFields.concat(data.values || [])
      const nextLink = data.links?.find((l: {rel: string, uri: string}) => l.rel === 'nextPage')
      nextUrl = nextLink?.uri || ''
    }

    let synced = 0
    let skipped = 0
    let notMatched = 0
    const notMatchedFields: string[] = []

    // For each JD field, get operations
    for (const jdField of allJDFields) {
      const fieldName = jdField.name?.toLowerCase().trim()
      const fieldId = fieldMap[fieldName]

      if (!fieldId) {
        notMatched++
        notMatchedFields.push(jdField.name)
        continue
      }

      // Get all operations for this field
      let opsUrl = `${JD_BASE}/organizations/${ORG_ID}/fields/${jdField.id}/fieldOperations?itemLimit=100`

      while (opsUrl) {
        const opsRes = await fetch(opsUrl, { headers })
        const opsData = await opsRes.json()

        for (const op of opsData.values || []) {
          const opTypeName = mapOperationType(op)
          const opTypeId = opTypeMap[opTypeName]
          const date = op.startDate ? op.startDate.split('T')[0] : null

          if (!opTypeId || !date) { skipped++; continue }

          // Upsert to avoid duplicates
          const { error } = await supabase.from('operations').upsert({
            field_id: fieldId,
            operation_type_id: opTypeId,
            date,
            notes: op.tillageProducts?.[0]?.tillageType || op.cropName || '',
            source: 'john_deere',
            jd_operation_id: op.id
          }, { onConflict: 'jd_operation_id' })

          if (!error) synced++
          else skipped++
        }

        const nextLink = opsData.links?.find((l: {rel: string, uri: string}) => l.rel === 'nextPage')
        opsUrl = nextLink?.uri || ''
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      notMatched,
      notMatchedFields: notMatchedFields.slice(0, 20)
    })

  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
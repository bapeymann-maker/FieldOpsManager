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
    return 'Tillage - Field Cultivator'
  }
  return 'Application - Chemical'
}

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const forceFullSync = searchParams.get('full') === 'true'

    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    const { data: syncData } = await supabase.from('sync_log').select('last_synced_at').eq('id', 1).single()
    const lastSyncedAt = forceFullSync ? '2020-01-01T00:00:00Z' : (syncData?.last_synced_at || '2020-01-01T00:00:00Z')
    const syncStartTime = new Date().toISOString()

    const { data: opTypes } = await supabase.from('operation_types').select('*')
    const opTypeMap = Object.fromEntries((opTypes || []).map(ot => [ot.name, ot.id]))

    const { data: dbFields } = await supabase.from('fields').select('id, name')
    const fieldMap = Object.fromEntries((dbFields || []).map(f => [f.name.toLowerCase().trim(), f.id]))

    // Get all JD fields
    let allJDFields: { id: string, name: string }[] = []
    let fieldsUrl = `${JD_BASE}/organizations/${ORG_ID}/fields?itemLimit=100`
    while (fieldsUrl) {
      const res = await fetch(fieldsUrl, { headers })
      const data = await res.json()
      allJDFields = allJDFields.concat(data.values || [])
      const nextLink = data.links?.find((l: { rel: string, uri: string }) => l.rel === 'nextPage')
      fieldsUrl = nextLink?.uri || ''
    }

    // Only process fields that exist in our DB
    const matchedFields = allJDFields.filter(f => fieldMap[f.name?.toLowerCase().trim()])

    let synced = 0
    let skipped = 0

    // Process fields in parallel batches of 20
    const BATCH_SIZE = 20
    for (let i = 0; i < matchedFields.length; i += BATCH_SIZE) {
      const batch = matchedFields.slice(i, i + BATCH_SIZE)

      await Promise.all(batch.map(async (jdField) => {
        const fieldId = fieldMap[jdField.name?.toLowerCase().trim()]

        let opsUrl = `${JD_BASE}/organizations/${ORG_ID}/fields/${jdField.id}/fieldOperations?itemLimit=100&modifiedSince=${encodeURIComponent(lastSyncedAt)}`

        while (opsUrl) {
          const opsRes = await fetch(opsUrl, { headers })
          const opsData = await opsRes.json()

          for (const op of opsData.values || []) {
            const opTypeName = mapOperationType(op)
            const opTypeId = opTypeMap[opTypeName]
            const date = op.startDate ? op.startDate.split('T')[0] : null
            if (!opTypeId || !date) { skipped++; return }

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

          const nextLink = opsData.links?.find((l: { rel: string, uri: string }) => l.rel === 'nextPage')
          opsUrl = nextLink?.uri || ''
        }
      }))
    }

    await supabase.from('sync_log').update({ last_synced_at: syncStartTime }).eq('id', 1)

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      lastSyncedAt,
      syncStartTime,
      incremental: !forceFullSync
    })

  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ORG_ID = '464281'

async function getAccessToken() {
  const { data } = await supabase.from('jd_tokens').select('*').eq('id', 1).single()
  if (!data) throw new Error('No token found')
  return data.access_token
}

export async function GET() {
  try {
    const token = await getAccessToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json'
    }

    // Fetch machine list from ISG endpoint
    const machineRes = await fetch(
      `https://api.deere.com/isg/equipment?organizationIds=${ORG_ID}`,
      { headers }
    )
    const machineText = await machineRes.text()
    let machineData: any = null
    try { machineData = JSON.parse(machineText) } catch (e) { }

    // If we got machines, try fetching location for the first one
    let locationSample: any = null
    let breadcrumbSample: any = null
    if (machineData?.values?.length > 0) {
      const firstMachine = machineData.values[0]
      const machineId = firstMachine.id || firstMachine.machineId

      // Try location history
      const locRes = await fetch(
        `https://api.deere.com/platform/machines/${machineId}/locationHistory`,
        { headers }
      )
      locationSample = { status: locRes.status, body: (await locRes.text()).slice(0, 300) }

      // Try breadcrumbs
      const bcRes = await fetch(
        `https://api.deere.com/platform/machines/${machineId}/breadcrumbs`,
        { headers }
      )
      breadcrumbSample = { status: bcRes.status, body: (await bcRes.text()).slice(0, 300) }
    }

    return NextResponse.json({
      machines_status: machineRes.status,
      machines_count: machineData?.values?.length || 0,
      first_machine: machineData?.values?.[0] || null,
      all_machine_names: machineData?.values?.map((m: any) => ({ id: m.id || m.machineId, name: m.name || m.machineDescriptor })) || [],
      location_sample: locationSample,
      breadcrumb_sample: breadcrumbSample,
      raw_if_error: machineRes.status !== 200 ? machineText.slice(0, 500) : null
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
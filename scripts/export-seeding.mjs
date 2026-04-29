import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

const TRACTOR_TYPES = new Set([
  'Track Tractor', 'Wheel Tractor', 'Tractor',
  'Two-wheel Drive Tractors - 140 Hp And Above',
  'Four-wheel Drive Tractor'
])

function certLabel(status) {
  switch (status) {
    case 'Certified': return 'Organic'
    case 'Transition 2': return 'T2'
    case 'Transition 1': return 'T1'
    default: return 'Conventional'
  }
}

async function main() {
  console.log('Fetching data...')

  // Get all fields
  const { data: fields } = await supabase
  .from('fields')
  .select('id, name, acres, region, client, cert_status')
  .neq('client', 'LB Pork')
  .order('name')

  // Get all seeding sessions (tractor only, 20+ min)
  const { data: sessions } = await supabase
    .from('machine_field_sessions')
    .select('field_id, duration_minutes, machine_id, machines(name, type)')
    .eq('operation_type', 'Seeding')
    .gte('duration_minutes', 20)

  console.log(`Fields: ${fields?.length}, Seeding sessions: ${sessions?.length}`)

  // Build per-field seeding efficiency
  const fieldMap = {}
  for (const f of fields || []) {
    fieldMap[f.id] = {
      ...f,
      tractorMinutes: 0,
      tractorSessions: 0,
      machines: new Set()
    }
  }

  for (const s of sessions || []) {
    const machineType = s.machines?.type || ''
    if (!TRACTOR_TYPES.has(machineType)) continue
    if (!fieldMap[s.field_id]) continue
    fieldMap[s.field_id].tractorMinutes += s.duration_minutes
    fieldMap[s.field_id].tractorSessions++
    if (s.machines?.name) fieldMap[s.field_id].machines.add(s.machines.name)
  }

  // Build rows
  const rows = Object.values(fieldMap).map(f => {
    const hrs = f.tractorMinutes / 60
    const acHr = f.acres && hrs > 0 ? Math.round((f.acres / hrs) * 10) / 10 : null
    const minPerAcre = acHr ? Math.round(60 / acHr * 10) / 10 : null
    return {
      field: f.name,
      region: f.region || '',
      client: f.client || 'Ufer Farms',
      cert: certLabel(f.cert_status),
      acres: f.acres || '',
      sessions: f.tractorSessions,
      tractorHrs: hrs > 0 ? Math.round(hrs * 10) / 10 : '',
      acHr: acHr || '',
      minPerAcre: minPerAcre || '',
      machines: [...f.machines].join(', ')
    }
  }).sort((a, b) => {
    // Sort: North first, then South, then by region alpha, then field name
    if (a.region !== b.region) return a.region.localeCompare(b.region)
    return a.field.localeCompare(b.field)
  })

  // Build Excel
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Field Ops Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Seeding Efficiency')

  // Title row
  ws.mergeCells('A1:J1')
  ws.getCell('A1').value = 'Seeding Efficiency Report — 2026 Season'
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F3D1A' } }
  ws.getCell('A1').alignment = { horizontal: 'left' }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAD5' } }

  // Generated date
  ws.mergeCells('A2:J2')
  ws.getCell('A2').value = `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B7A5A' }, italic: true }

  ws.addRow([]) // spacer

  // Headers
  const headers = ['Field', 'Region', 'Client', 'Cert', 'Acres', 'Sessions', 'Tractor Hrs', 'Ac/Hr', 'Min/Acre', 'Machines Used']
  const headerRow = ws.addRow(headers)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A2D' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF1F4A1F' } }
    }
  })
  headerRow.height = 20

  // Data rows
  let currentRegion = ''
  let rowIndex = 0

  for (const r of rows) {
    // Region separator
    if (r.region !== currentRegion && r.region) {
      currentRegion = r.region
      const sepRow = ws.addRow([`${r.region}ern Operation`])
      sepRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF8A9A6A' } }
      sepRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0F0B' } }
      ws.mergeCells(`A${sepRow.number}:J${sepRow.number}`)
    }

    const dataRow = ws.addRow([
      r.field,
      r.region,
      r.client,
      r.cert,
      r.acres,
      r.sessions || '',
      r.tractorHrs || '',
      r.acHr || '',
      r.minPerAcre || '',
      r.machines
    ])

    const isEven = rowIndex % 2 === 0
    const bgColor = isEven ? 'FFFAFAF5' : 'FFFFFFF8'

    dataRow.eachCell((cell, colNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.font = { size: 10 }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFDDDDCC' } }
      }
      // Right-align numbers
      if (colNum >= 5) cell.alignment = { horizontal: 'right' }
    })

    // Color-code cert column
    const certCell = dataRow.getCell(4)
    const certColors = {
      'Organic': 'FF2D7A2D',
      'T2': 'FF8A8A00',
      'T1': 'FF9A6600',
      'Conventional': 'FF6B7A5A'
    }
    certCell.font = { size: 10, bold: true, color: { argb: certColors[r.cert] || 'FF000000' } }

    // Highlight good ac/hr (>50)
    if (r.acHr && r.acHr >= 50) {
      dataRow.getCell(8).font = { size: 10, bold: true, color: { argb: 'FF1A6A1A' } }
    }

    // Flag slow fields (<30 ac/hr) in amber
    if (r.acHr && r.acHr < 30) {
      dataRow.getCell(8).font = { size: 10, bold: true, color: { argb: 'FFCC8800' } }
    }

    rowIndex++
  }

  // Summary row
  ws.addRow([])
  const seedingRows = rows.filter(r => r.tractorHrs)
  const avgAcHr = seedingRows.length > 0
    ? Math.round(seedingRows.reduce((s, r) => s + (r.acHr || 0), 0) / seedingRows.length * 10) / 10
    : ''
  const totalAcres = rows.reduce((s, r) => s + (Number(r.acres) || 0), 0)
  const totalHrs = rows.reduce((s, r) => s + (Number(r.tractorHrs) || 0), 0)

  const summaryRow = ws.addRow(['SUMMARY', '', '', '', totalAcres, seedingRows.length, Math.round(totalHrs * 10) / 10, avgAcHr, '', ''])
  summaryRow.eachCell(cell => {
    cell.font = { bold: true, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAD5' } }
    cell.border = { top: { style: 'medium', color: { argb: 'FF2D6A2D' } } }
  })

  // Column widths
  ws.getColumn(1).width = 32  // Field
  ws.getColumn(2).width = 12  // Region
  ws.getColumn(3).width = 14  // Client
  ws.getColumn(4).width = 12  // Cert
  ws.getColumn(5).width = 10  // Acres
  ws.getColumn(6).width = 10  // Sessions
  ws.getColumn(7).width = 12  // Tractor Hrs
  ws.getColumn(8).width = 10  // Ac/Hr
  ws.getColumn(9).width = 10  // Min/Acre
  ws.getColumn(10).width = 40 // Machines

  // Freeze header rows
  ws.views = [{ state: 'frozen', ySplit: 4 }]

  const outPath = 'seeding-efficiency-2026.xlsx'
  await wb.xlsx.writeFile(outPath)
  console.log(`\nExported to ${outPath}`)
  console.log(`Fields with seeding data: ${seedingRows.length}`)
  console.log(`Average ac/hr: ${avgAcHr}`)
}

main().catch(console.error)

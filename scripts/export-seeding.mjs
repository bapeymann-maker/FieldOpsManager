import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

const supabase = createClient(
  'https://tpcwaghvlwkcgqyaonzk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
)

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

  const { data: fields } = await supabase
    .from('fields')
    .select('id, name, acres, region, client, cert_status')
    .neq('client', 'LB Pork')
    .order('name')

  // Use planter sessions as the primary data source for seeding efficiency
  const { data: sessions } = await supabase
    .from('machine_field_sessions')
    .select('field_id, duration_minutes, machine_id, machines(name, type)')
    .eq('operation_type', 'Seeding')
    .eq('machines.type', 'Planter')
    .gte('duration_minutes', 20)

  console.log(`Fields: ${fields?.length}, Planter seeding sessions: ${sessions?.length}`)

  // Build per-field seeding efficiency using planter time
  const fieldMap = {}
  for (const f of fields || []) {
    fieldMap[f.id] = {
      ...f,
      planterMinutes: 0,
      planterSessions: 0,
      machines: new Set()
    }
  }

  for (const s of sessions || []) {
    const machineType = s.machines?.type || ''
    if (machineType !== 'Planter') continue
    if (!fieldMap[s.field_id]) continue
    fieldMap[s.field_id].planterMinutes += s.duration_minutes
    fieldMap[s.field_id].planterSessions++
    if (s.machines?.name) fieldMap[s.field_id].machines.add(s.machines.name)
  }

  // Build rows sorted by region then name
  const rows = Object.values(fieldMap)
    .map(f => ({
      field: f.name,
      region: f.region || '',
      client: f.client || 'Ufer Farms',
      cert: certLabel(f.cert_status),
      acres: f.acres || null,
      sessions: f.planterSessions || null,
      planterHrs: f.planterMinutes > 0 ? Math.round((f.planterMinutes / 60) * 100) / 100 : null,
      acHr: (f.acres && f.planterMinutes > 0)
        ? Math.round((f.acres / (f.planterMinutes / 60)) * 10) / 10
        : null,
      minPerAcre: (f.acres && f.planterMinutes > 0)
        ? Math.round((f.planterMinutes / f.acres) * 10) / 10
        : null,
      machines: [...f.machines].join(', ')
    }))
    .sort((a, b) => {
      if (a.region !== b.region) return (a.region || '').localeCompare(b.region || '')
      return a.field.localeCompare(b.field)
    })

  const dataRows = rows.filter(r => r.acHr !== null)
  const avgAcHr = dataRows.length > 0
    ? Math.round(dataRows.reduce((s, r) => s + r.acHr, 0) / dataRows.length * 10) / 10
    : 0
  const totalAcres = rows.reduce((s, r) => s + (r.acres || 0), 0)
  const totalHrs = rows.reduce((s, r) => s + (r.planterHrs || 0), 0)

  // Build Excel
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Field Ops Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Seeding Efficiency 2026', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 1 }]
  })

  // ── Title block ──────────────────────────────────────────
  ws.mergeCells('A1:J1')
  const titleCell = ws.getCell('A1')
  titleCell.value = 'Seeding Efficiency Report — 2026 Season'
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF1A3A1A' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8EAD0' } }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 28

  ws.mergeCells('A2:J2')
  ws.getCell('A2').value = `Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`
  ws.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF6B7A5A' } }
  ws.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7F0' } }

  ws.mergeCells('A3:J3')
  ws.getCell('A3').value = `Fields with data: ${dataRows.length} of ${rows.length}   |   Avg Ac/Hr: ${avgAcHr}   |   Total Planter Hrs: ${totalHrs.toFixed(1)}   |   Source: Planter GPS`
  ws.getCell('A3').font = { size: 10, bold: true, color: { argb: 'FF2D6A2D' } }
  ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7F0' } }

  ws.addRow([]) // spacer row 4

  // ── Column headers (row 5) ─────────────────────────────
  const COL_HEADERS = ['Field', 'Region', 'Client', 'Cert', 'Acres', 'Sessions', 'Planter Hrs', 'Ac/Hr', 'Min/Acre', 'Planter Used']
  const headerRow = ws.addRow(COL_HEADERS)
  headerRow.height = 22
  headerRow.eachCell((cell, colNum) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A2D' } }
    cell.alignment = { horizontal: colNum >= 5 ? 'center' : 'left', vertical: 'middle' }
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF1A4A1A' } },
      bottom: { style: 'medium', color: { argb: 'FF1A4A1A' } },
      left: { style: 'thin', color: { argb: 'FF3A7A3A' } },
      right: { style: 'thin', color: { argb: 'FF3A7A3A' } },
    }
  })

  // ── Data rows ─────────────────────────────────────────
  let currentRegion = ''
  let dataRowIndex = 0

  for (const r of rows) {
    // Region divider row
    if (r.region !== currentRegion) {
      currentRegion = r.region
      const divRow = ws.addRow([`▼  ${r.region}ern Operation`])
      ws.mergeCells(`A${divRow.number}:J${divRow.number}`)
      divRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FFC8D4A0' } }
      divRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0F0B' } }
      divRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
      divRow.height = 18
    }

    const dataRow = ws.addRow([
      r.field,
      r.region,
      r.client,
      r.cert,
      r.acres,
      r.sessions,
      r.planterHrs,
      r.acHr,
      r.minPerAcre,
      r.machines
    ])

    const isEven = dataRowIndex % 2 === 0
    const bgColor = isEven ? 'FFFAFCF7' : 'FFFFFFFF'

    dataRow.eachCell((cell, colNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.font = { size: 10 }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFDDEAD0' } },
        right: { style: 'thin', color: { argb: 'FFDDEAD0' } }
      }
      if (colNum >= 5 && colNum <= 9) cell.alignment = { horizontal: 'right' }
    })

    // Format numbers
    dataRow.getCell(5).numFmt = '#,##0.00'   // Acres
    dataRow.getCell(7).numFmt = '#,##0.00'   // Planter Hrs
    dataRow.getCell(8).numFmt = '#,##0.0'    // Ac/Hr
    dataRow.getCell(9).numFmt = '#,##0.0'    // Min/Acre

    // Cert color
    const certColors = { 'Organic': 'FF1A6A1A', 'T2': 'FF7A7A00', 'T1': 'FF8A5500', 'Conventional': 'FF5A6A4A' }
    dataRow.getCell(4).font = { size: 10, bold: true, color: { argb: certColors[r.cert] || 'FF000000' } }

    // Ac/Hr conditional color
    if (r.acHr !== null) {
      if (r.acHr >= 60) dataRow.getCell(8).font = { size: 10, bold: true, color: { argb: 'FF1A7A1A' } }
      else if (r.acHr >= 40) dataRow.getCell(8).font = { size: 10, bold: true, color: { argb: 'FF2D6A2D' } }
      else if (r.acHr >= 25) dataRow.getCell(8).font = { size: 10, color: { argb: 'FFAA7700' } }
      else dataRow.getCell(8).font = { size: 10, bold: true, color: { argb: 'FFCC3300' } }
    } else {
      dataRow.getCell(8).font = { size: 10, color: { argb: 'FFAAAAAA' } }
      dataRow.getCell(8).value = 'No data'
      dataRow.getCell(9).value = null
    }

    dataRowIndex++
  }

  // ── Summary row ───────────────────────────────────────
  ws.addRow([])
  const sumRow = ws.addRow([
    'TOTALS / AVERAGES', '', '', '',
    totalAcres,
    dataRows.reduce((s, r) => s + (r.sessions || 0), 0),
    Math.round(totalHrs * 100) / 100,
    avgAcHr,
    dataRows.length > 0 ? Math.round(dataRows.reduce((s, r) => s + (r.minPerAcre || 0), 0) / dataRows.length * 10) / 10 : null,
    `${dataRows.length} fields with data`
  ])

  sumRow.eachCell((cell, colNum) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FF1A3A1A' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8EAD0' } }
    cell.border = { top: { style: 'medium', color: { argb: 'FF2D6A2D' } } }
    if (colNum >= 5 && colNum <= 9) cell.alignment = { horizontal: 'right' }
  })
  sumRow.getCell(5).numFmt = '#,##0.00'
  sumRow.getCell(7).numFmt = '#,##0.00'
  sumRow.getCell(8).numFmt = '#,##0.0'
  sumRow.getCell(9).numFmt = '#,##0.0'

  // ── Legend ────────────────────────────────────────────
  ws.addRow([])
  const legendRow = ws.addRow(['Ac/Hr Legend:', '', '≥60 = Excellent', '', '40–59 = Good', '', '25–39 = Average', '', '<25 = Slow — consider custom hire'])
  legendRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF4A5A3A' } }
  legendRow.getCell(3).font = { size: 9, bold: true, color: { argb: 'FF1A7A1A' } }
  legendRow.getCell(5).font = { size: 9, bold: true, color: { argb: 'FF2D6A2D' } }
  legendRow.getCell(7).font = { size: 9, color: { argb: 'FFAA7700' } }
  legendRow.getCell(9).font = { size: 9, bold: true, color: { argb: 'FFCC3300' } }

  ws.addRow([])
  ws.getCell(`A${ws.lastRow.number + 1}`).value = 'Note: Ac/Hr calculated from planter GPS time in field. Fields showing "No data" have not been seeded yet or planter telematics was not active.'
  ws.getCell(`A${ws.lastRow.number}`).font = { size: 9, italic: true, color: { argb: 'FF6B7A5A' } }
  ws.mergeCells(`A${ws.lastRow.number}:J${ws.lastRow.number}`)

  // ── Column widths ─────────────────────────────────────
  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 10
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 10
  ws.getColumn(6).width = 10
  ws.getColumn(7).width = 13
  ws.getColumn(8).width = 10
  ws.getColumn(9).width = 11
  ws.getColumn(10).width = 44

  // ── AutoFilter ────────────────────────────────────────
  ws.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: 10 }
  }

  // ── Print settings ────────────────────────────────────
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '5:5',
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
  }

  const outPath = 'seeding-efficiency-2026.xlsx'
  await wb.xlsx.writeFile(outPath)

  console.log(`\n✓ Saved to ${outPath}`)
  console.log(`  Fields with planter data: ${dataRows.length} of ${rows.length}`)
  console.log(`  Average ac/hr: ${avgAcHr}`)
  console.log(`  Total planter hours: ${totalHrs.toFixed(1)}`)
}

main().catch(console.error)

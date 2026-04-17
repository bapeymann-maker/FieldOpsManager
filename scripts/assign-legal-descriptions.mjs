'use client'

import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getFields, getOperationTypes } from '@/lib/data'
import { supabase as supabaseClient } from '@/lib/supabase'
import AddOperationModal from '@/components/AddOperationModal'

const FieldMap = dynamic(() => import('@/components/FieldMap'), { ssr: false })

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Field = {
  id: string; name: string; acres: number | null; region: string | null;
  boundary: object | null; client: string | null; cert_status: string | null;
  cert_notes: string | null; cert_transition_start: string | null; cert_expiry: string | null;
}
type OperationType = { id: string; name: string; color: string }
type Operation = {
  id: string; date: string; field_id: string; operation_type_id: string;
  notes: string; source: string; crop_type: string | null;
  fields: { name: string }
  operation_types: { name: string; color: string }
}
type GDURecord = {
  field_id: string; date: string; daily_gdu: number; cumulative_gdu: number;
  cumulative_rainfall: number; rainfall_inches: number; crop_type: string;
}
type SelectedOp = { op: Operation; fieldName: string }

// Operation abbreviations
const OP_ABBREV: Record<string, string> = {
  'Application - Chemical': 'AC',
  'Application - Fertilizer': 'AF',
  'Harvest': 'H',
  'Seeding': 'S',
  'Tillage - Disk': 'D',
  'Tillage - Field Cultivator': 'FC',
  'Tillage - Row Cultivator': 'RC',
  'Tillage - Secondary': 'ST',
  'Tillage - Shank': 'TS',
  'Tillage - Tine Weeder': 'TW',
  'Tillage - Rotary Hoe': 'RH',
  'Manual Walking': 'MW',
}

const TILLAGE_OP_NAMES = new Set([
  'Tillage - Disk', 'Tillage - Field Cultivator', 'Tillage - Row Cultivator',
  'Tillage - Secondary', 'Tillage - Shank', 'Tillage - Tine Weeder',
  'Tillage - Rotary Hoe', 'Manual Walking'
])

// Growth stage helpers
const ACTION_THRESHOLDS = [
  { gdu: 30, action: 'Tine Weed', stage: 'Germination' },
  { gdu: 70, action: 'Tine Weed', stage: 'Germination' },
  { gdu: 100, action: 'Rotary Hoe', stage: 'VE' },
  { gdu: 150, action: 'Tine Weed', stage: 'V1' },
  { gdu: 200, action: 'Tine Weed', stage: 'V2' },
  { gdu: 250, action: 'Row Cultivator', stage: 'V3' },
  { gdu: 300, action: 'Row Cultivator', stage: 'V4' },
  { gdu: 400, action: 'Row Cultivator', stage: 'V5' },
  { gdu: 475, action: 'Row Cultivator', stage: 'V6' },
]

function getGrowthStage(gdu: number): string {
  if (gdu < 30) return 'Germination'
  if (gdu < 70) return 'Germination'
  if (gdu < 100) return 'Germination'
  if (gdu < 150) return 'VE'
  if (gdu < 200) return 'V1'
  if (gdu < 250) return 'V2'
  if (gdu < 300) return 'V3'
  if (gdu < 400) return 'V4'
  if (gdu < 475) return 'V5'
  if (gdu < 500) return 'V6'
  return 'V6+'
}

function getNextAction(gdu: number): { action: string; threshold: number; stage: string } | null {
  for (const t of ACTION_THRESHOLDS) {
    if (gdu < t.gdu) return t
  }
  return null
}

function normalizeCropType(cropType: string | null): string {
  if (!cropType) return 'Unknown'
  const u = cropType.toUpperCase().replace(/ /g, '_')
  if (u.includes('SWEET')) return 'Sweet Corn'
  if (u.includes('CORN')) return 'Corn'
  if (u.includes('SOY') || u.includes('BEAN')) return 'Soybeans'
  if (u.includes('OAT')) return 'Oats'
  if (u.includes('PEA')) return 'Peas'
  return cropType
}

const SECTIONS = [
  { label: 'Northern Operation', filter: (f: Field) => f.region === 'North' && f.client !== 'LB Pork' },
  { label: 'Southern Operation', filter: (f: Field) => f.region === 'South' && f.client !== 'LB Pork' },
  { label: 'LB Pork', filter: (f: Field) => f.client === 'LB Pork' },
]

const CERT_GROUPS = [
  { label: 'Certified Organic', key: 'Certified', color: '#4aaa4a', badge: 'O' },
  { label: 'Transition 2', key: 'Transition 2', color: '#aaaa00', badge: 'T2' },
  { label: 'Transition 1', key: 'Transition 1', color: '#cc8800', badge: 'T1' },
  { label: 'Conventional', key: 'Conventional', color: '#6b7a5a', badge: 'CONV' },
]

function certBadge(status: string | null) {
  switch (status) {
    case 'Certified':    return 'O'
    case 'Transition 2': return 'T2'
    case 'Transition 1': return 'T1'
    default:             return 'CONV'
  }
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function isWeekend(year: number, month: number, day: number) {
  const d = new Date(year, month, day).getDay()
  return d === 0 || d === 6
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Home() {
  const now = new Date()
  const router = useRouter()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [fields, setFields] = useState<Field[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [allYearOps, setAllYearOps] = useState<Operation[]>([])
  const [allOps, setAllOps] = useState<Operation[]>([])
  const [opTypes, setOpTypes] = useState<OperationType[]>([])
  const [gduData, setGduData] = useState<GDURecord[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'calendar' | 'year' | 'map' | 'log' | 'cert' | 'weed'>('calendar')
  const [mapMode, setMapMode] = useState<'work' | 'daily'>('work')
  const [showModal, setShowModal] = useState(false)
  const [editOp, setEditOp] = useState<Operation | null>(null)
  const [selectedOp, setSelectedOp] = useState<SelectedOp | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<Field | null>(null)
  const [certEdit, setCertEdit] = useState({ status: '', transition_start: '', expiry: '', notes: '' })
  const [savingCert, setSavingCert] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const today = now.getDate()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const daysInMonth = getDaysInMonth(year, month)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function toggleSection(label: string) {
    setCollapsedSections(prev => ({ ...prev, [label]: !prev[label] }))
  }

  function goToFieldOnMap(fieldId: string) {
    setFocusFieldId(fieldId)
    setView('map')
  }

  function openCertEdit(field: Field) {
    setEditingField(field)
    setCertEdit({
      status: field.cert_status || 'Conventional',
      transition_start: field.cert_transition_start || '',
      expiry: field.cert_expiry || '',
      notes: field.cert_notes || ''
    })
  }

  async function saveCert() {
    if (!editingField) return
    setSavingCert(true)
    await supabase.from('fields').update({
      cert_status: certEdit.status,
      cert_transition_start: certEdit.transition_start || null,
      cert_expiry: certEdit.expiry || null,
      cert_notes: certEdit.notes || null
    }).eq('id', editingField.id)
    setSavingCert(false)
    setEditingField(null)
    loadData()
  }

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (isMobile && view === 'calendar') setView('log')
  }, [isMobile])

  async function loadData() {
    setLoading(true)
    try {
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
      const [fieldsData, opTypesData] = await Promise.all([getFields(), getOperationTypes()])
      const { data: opsData } = await supabaseClient.from('operations').select('*, fields(name), operation_types(name, color)').gte('date', startDate).lte('date', endDate)
      const { data: allOpsData } = await supabaseClient.from('operations').select('*, operation_types(name, color)').order('date', { ascending: false })
      const { data: gduRaw } = await supabaseClient.from('gdu_daily').select('*').gte('date', `${currentYear}-01-01`)
      setFields(fieldsData || [])
      setOperations(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
      setGduData(gduRaw || [])
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function loadYearData() {
    setLoading(true)
    try {
      const [fieldsData, opTypesData] = await Promise.all([getFields(), getOperationTypes()])
      const { data: opsData } = await supabaseClient.from('operations').select('*, fields(name), operation_types(name, color)').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
      const { data: allOpsData } = await supabaseClient.from('operations').select('*, operation_types(name, color)').order('date', { ascending: false })
      const { data: gduRaw } = await supabaseClient.from('gdu_daily').select('*').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
      setFields(fieldsData || [])
      setAllYearOps(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
      setGduData(gduRaw || [])
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function loadLogData() {
    setLoading(true)
    try {
      const [fieldsData, opTypesData] = await Promise.all([getFields(), getOperationTypes()])
      const { data: opsData } = await supabaseClient.from('operations').select('*, fields(name), operation_types(name, color)').order('date', { ascending: false }).limit(100)
      const { data: allOpsData } = await supabaseClient.from('operations').select('*, operation_types(name, color)').order('date', { ascending: false })
      const { data: gduRaw } = await supabaseClient.from('gdu_daily').select('*').gte('date', `${currentYear}-01-01`)
      setFields(fieldsData || [])
      setOperations(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
      setGduData(gduRaw || [])
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  useEffect(() => {
    if (view === 'year') loadYearData()
    else if (view === 'log') loadLogData()
    else loadData()
  }, [year, month, view])

  const activeOps = view === 'year' ? allYearOps : operations
  const acresSummary = opTypes.map(ot => {
    const opsOfType = activeOps.filter(op => op.operation_type_id === ot.id)
    const uniqueFieldIds = [...new Set(opsOfType.map(op => op.field_id))]
    const totalAcres = uniqueFieldIds.reduce((sum, fid) => sum + (fields.find(f => f.id === fid)?.acres || 0), 0)
    return { ...ot, totalAcres, count: opsOfType.length }
  }).filter(s => s.count > 0)

  const totalAcresWorked = acresSummary.reduce((sum, s) => sum + s.totalAcres, 0)

  // Cumulative GDU from Jan 1 to a specific date, averaged per region
  function getCumulativeGDUForDay(day: number, region: 'North' | 'South') {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const startOfYear = `${year}-01-01`
    const regionFieldIds = fields.filter(f => f.region === region && f.client !== 'LB Pork').map(f => f.id)
    const records = gduData.filter(g => g.date >= startOfYear && g.date <= dateStr && regionFieldIds.includes(g.field_id))
    if (records.length === 0) return null
    const fieldTotals: Record<string, number> = {}
    for (const r of records) fieldTotals[r.field_id] = (fieldTotals[r.field_id] || 0) + r.daily_gdu
    const vals = Object.values(fieldTotals)
    if (vals.length === 0) return null
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10
  }

  // Running cumulative GDU from Jan 1 to end of month (for year view)
  function getCumulativeGDUForMonth(monthIndex: number, region: 'North' | 'South') {
    const startOfYear = `${year}-01-01`
    const endOfMonth = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(getDaysInMonth(year, monthIndex)).padStart(2, '0')}`
    const regionFieldIds = fields.filter(f => f.region === region && f.client !== 'LB Pork').map(f => f.id)
    const records = gduData.filter(g => g.date >= startOfYear && g.date <= endOfMonth && regionFieldIds.includes(g.field_id))
    if (records.length === 0) return null
    const fieldTotals: Record<string, number> = {}
    for (const r of records) fieldTotals[r.field_id] = (fieldTotals[r.field_id] || 0) + r.daily_gdu
    const vals = Object.values(fieldTotals)
    if (vals.length === 0) return null
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
  }

  // Daily GDU average for a region
  function getGDUForDay(day: number, region: 'North' | 'South') {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const regionFieldIds = fields.filter(f => f.region === region && f.client !== 'LB Pork').map(f => f.id)
    const dayRecords = gduData.filter(g => g.date === dateStr && regionFieldIds.includes(g.field_id))
    if (dayRecords.length === 0) return null
    const avg = dayRecords.reduce((sum, g) => sum + g.daily_gdu, 0) / dayRecords.length
    return Math.round(avg * 10) / 10
  }

  function getGDUForMonth(monthIndex: number, region: 'North' | 'South') {
    const regionFieldIds = fields.filter(f => f.region === region && f.client !== 'LB Pork').map(f => f.id)
    const monthStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const monthRecords = gduData.filter(g => g.date.startsWith(monthStr) && regionFieldIds.includes(g.field_id))
    if (monthRecords.length === 0) return null
    const total = monthRecords.reduce((sum, g) => sum + g.daily_gdu, 0) / regionFieldIds.length
    return Math.round(total * 10) / 10
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleDelete() {
    if (!selectedOp) return
    setDeleting(true)
    await supabase.from('operations').delete().eq('id', selectedOp.op.id)
    setSelectedOp(null)
    setDeleting(false)
    if (view === 'year') loadYearData()
    else if (view === 'log') loadLogData()
    else loadData()
  }

  function getOperation(fieldId: string, day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return operations.find(op => op.field_id === fieldId && op.date === dateStr) || null
  }

  function getOpsForMonth(fieldId: string, m: number) {
    return allYearOps.filter(op => new Date(op.date + 'T12:00:00').getMonth() === m && op.field_id === fieldId)
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1)
  }

  function exportToCSV() {
    if (activeOps.length === 0) return
    const rows = activeOps.map(op => {
      const field = fields.find(f => f.id === op.field_id)
      return [new Date(op.date + 'T12:00:00').toLocaleDateString('en-US'), field?.name || '', field?.region || '', field?.client || '', field?.cert_status || '', field?.acres || '', op.operation_types?.name || '', op.notes || '', op.source || 'manual']
    })
    const csv = [['Date', 'Field', 'Region', 'Client', 'Cert Status', 'Acres', 'Operation Type', 'Notes', 'Source'], ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `field-ops-${view === 'year' ? year : `${year}-${String(month + 1).padStart(2, '0')}`}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Build heat map fields with all computed metrics
  const fieldsWithHeat = fields.map(f => {
    const fieldOps = allOps
      .filter(op => op.field_id === f.id && op.date >= `${currentYear}-01-01`)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const latest = fieldOps[0]
    const daysSinceWork = latest ? daysSince(latest.date) : undefined
    const lastOpType = latest?.operation_types?.name || ''

    const lastSeeding = fieldOps.find(op => op.operation_types?.name === 'Seeding')
    const lastHarvest = fieldOps.find(op => op.operation_types?.name === 'Harvest')
    const isInCrop = lastSeeding ? (!lastHarvest || new Date(lastSeeding.date) > new Date(lastHarvest.date)) : false
    const seedingDate = lastSeeding?.date
    const cropType = normalizeCropType(lastSeeding?.crop_type || lastSeeding?.notes || null)

    // GDU metrics from seeding date
    const fieldGDU = seedingDate ? gduData.filter(g => g.field_id === f.id && g.date >= seedingDate) : []
    const sortedGDU = [...fieldGDU].sort((a, b) => b.date.localeCompare(a.date))
    const latestGDU = sortedGDU[0]
    const cumulativeGDU = latestGDU?.cumulative_gdu
    const cumulativeRainfall = latestGDU?.cumulative_rainfall

    // GDU and rainfall since last work
    let gduSinceLastWork: number | undefined
    let rainfallSinceLastWork: number | undefined
    if (latest && daysSinceWork !== undefined && daysSinceWork > 0 && isInCrop && seedingDate) {
      const lastWorkDate = latest.date
      if (lastWorkDate > seedingDate) {
        const recordsSinceWork = fieldGDU.filter(g => g.date > lastWorkDate)
        const gduSum = recordsSinceWork.reduce((sum, g) => sum + g.daily_gdu, 0)
        const rainSum = recordsSinceWork.reduce((sum, g) => sum + (g.rainfall_inches || 0), 0)
        gduSinceLastWork = gduSum > 0 ? Math.round(gduSum * 10) / 10 : undefined
        rainfallSinceLastWork = rainSum > 0 ? Math.round(rainSum * 100) / 100 : undefined
      }
    }

    // GDUs since last TILLAGE operation (for priority)
    const lastTillageOp = fieldOps.find(op => TILLAGE_OP_NAMES.has(op.operation_types?.name || ''))
    let gduSinceLastTillage: number | undefined
    let lastTillageOpName: string | undefined
    if (lastTillageOp && isInCrop && seedingDate) {
      const lastTillageDate = lastTillageOp.date
      lastTillageOpName = lastTillageOp.operation_types?.name
      if (lastTillageDate >= seedingDate) {
        const recordsSinceTillage = fieldGDU.filter(g => g.date > lastTillageDate)
        const sum = recordsSinceTillage.reduce((s, g) => s + g.daily_gdu, 0)
        gduSinceLastTillage = Math.round(sum)
      }
    }

    return {
      ...f, daysSinceWork, isInCrop, lastOpType, cumulativeGDU, cumulativeRainfall,
      gduSinceLastWork, rainfallSinceLastWork, gduSinceLastTillage, lastTillageOpName,
      cropType, seedingDate
    }
  })

  const heatMapFields = mapMode === 'daily' ? fieldsWithHeat.filter(f => f.isInCrop) : fieldsWithHeat

  // Build field metadata map for FieldNameCell
  const fieldMetaMap: Record<string, { gduSinceLastTillage?: number; isInCrop: boolean }> = {}
  for (const f of fieldsWithHeat) {
    fieldMetaMap[f.id] = { gduSinceLastTillage: f.gduSinceLastTillage, isInCrop: f.isInCrop }
  }

  // Forecast date for weeding action plan
  function getForecastDate(currentGDU: number, targetGDU: number, fieldId: string): string {
    const recent = gduData.filter(g => g.field_id === fieldId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)
    const avgDaily = recent.length > 0 ? recent.reduce((s, g) => s + g.daily_gdu, 0) / recent.length : 15
    if (avgDaily <= 0) return 'Unknown'
    const daysNeeded = Math.ceil((targetGDU - currentGDU) / avgDaily)
    if (daysNeeded <= 0) return 'Now'
    if (daysNeeded > 90) return '90+ days'
    const date = new Date()
    date.setDate(date.getDate() + daysNeeded)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const onSaved = () => {
    setShowModal(false); setEditOp(null)
    if (view === 'year') loadYearData()
    else if (view === 'log') loadLogData()
    else loadData()
  }

  const sectionHeaderStyle = {
    padding: '6px 12px', fontSize: '10px', letterSpacing: '0.15em',
    textTransform: 'uppercase' as const, color: '#8a9a6a', backgroundColor: '#0a0f0b',
    borderBottom: '1px solid #2a3020', cursor: 'pointer', userSelect: 'none' as const,
    display: 'flex', alignItems: 'center', gap: '8px'
  }

  const fieldNameStyle = { cursor: 'pointer', borderBottom: '1px dotted #4a5a3a', color: '#a8b888' }

  const gduCellStyle = (hasData: boolean) => ({
    padding: '2px 2px', textAlign: 'center' as const,
    fontSize: '9px', color: hasData ? '#6aaa6a' : '#2a3020',
    borderTop: '1px solid #1a2016'
  })

  const cumulCellStyle = (hasData: boolean) => ({
    padding: '2px 2px', textAlign: 'center' as const,
    fontSize: '9px', color: hasData ? '#aad4ff' : '#2a3020',
  })

  function FieldNameCell({ field }: { field: Field }) {
    const meta = fieldMetaMap[field.id]
    return (
      <>
        <span onClick={e => { e.stopPropagation(); goToFieldOnMap(field.id) }} style={fieldNameStyle} title="View on heat map">{field.name}</span>
        <span style={{ fontSize: '9px', color: '#6b7a5a', marginLeft: '5px' }}>{certBadge(field.cert_status)}</span>
        {field.acres && <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>{field.acres}ac</span>}
        {meta?.isInCrop && meta.gduSinceLastTillage !== undefined && (
          <span style={{ fontSize: '9px', color: '#cc8800', marginLeft: '5px' }} title="GDUs since last tillage">
            {meta.gduSinceLastTillage}↑
          </span>
        )}
      </>
    )
  }

  const certTotals = CERT_GROUPS.map(g => {
    const groupFields = fields.filter(f => (f.cert_status || 'Conventional') === g.key && f.client !== 'LB Pork')
    return { ...g, count: groupFields.length, totalAcres: groupFields.reduce((sum, f) => sum + (f.acres || 0), 0) }
  })

  const p = isMobile ? '12px 16px' : '16px 32px'

  // Weeding action plan data
  const weedingFields = fieldsWithHeat.filter(f =>
    f.isInCrop &&
    f.cumulativeGDU !== undefined &&
    f.client !== 'LB Pork' &&
    (f.region === 'North' || f.region === 'South')
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1410', color: '#e8ead5', fontFamily: "'Georgia', serif" }}
      onClick={() => { setSelectedOp(null); setShowMenu(false) }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a3020', padding: p, backgroundColor: '#0f1410' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div>
            {!isMobile && <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#6b7a5a', textTransform: 'uppercase', marginBottom: '4px' }}>Field Operations Manager</div>}
            <h1 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 'normal', margin: 0, color: '#c8d4a0' }}>
              {isMobile ? 'Field Ops' : 'Activity Calendar'}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setShowModal(true)} style={{ padding: isMobile ? '10px 18px' : '8px 14px', backgroundColor: '#2d6a2d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '15px' : '12px' }}>+ Log</button>
            {isMobile ? (
              <button onClick={e => { e.stopPropagation(); setShowMenu(m => !m) }} style={{ padding: '10px 14px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>☰</button>
            ) : (
              <>
                <button onClick={exportToCSV} style={{ padding: '6px 16px', background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>↓ CSV</button>
                <button onClick={handleSignOut} style={{ padding: '6px 14px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Sign Out</button>
              </>
            )}
          </div>
        </div>

        {isMobile && showMenu && (
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '6px', padding: '8px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button onClick={() => { exportToCSV(); setShowMenu(false) }} style={{ padding: '10px 16px', background: 'none', border: 'none', color: '#8a9a6a', cursor: 'pointer', fontSize: '14px', textAlign: 'left' }}>↓ Export CSV</button>
            <button onClick={() => { handleSignOut(); setShowMenu(false) }} style={{ padding: '10px 16px', background: 'none', border: 'none', color: '#6b7a5a', cursor: 'pointer', fontSize: '14px', textAlign: 'left' }}>Sign Out</button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid #2a3020', borderRadius: '4px', overflow: 'hidden' }}>
            {isMobile && <button onClick={() => setView('log')} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'log' ? '#2a3020' : 'transparent', color: view === 'log' ? '#c8d4a0' : '#6b7a5a' }}>Recent</button>}
            <button onClick={() => setView('calendar')} style={{ padding: isMobile ? '8px 10px' : '6px 12px', cursor: 'pointer', fontSize: isMobile ? '12px' : '12px', border: 'none', backgroundColor: view === 'calendar' ? '#2a3020' : 'transparent', color: view === 'calendar' ? '#c8d4a0' : '#6b7a5a' }}>Month</button>
            <button onClick={() => setView('year')} style={{ padding: isMobile ? '8px 10px' : '6px 12px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'year' ? '#2a3020' : 'transparent', color: view === 'year' ? '#c8d4a0' : '#6b7a5a' }}>Year</button>
            <button onClick={() => setView('map')} style={{ padding: isMobile ? '8px 10px' : '6px 12px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'map' ? '#2a3020' : 'transparent', color: view === 'map' ? '#c8d4a0' : '#6b7a5a' }}>Map</button>
            <button onClick={() => setView('cert')} style={{ padding: isMobile ? '8px 10px' : '6px 12px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'cert' ? '#2a3020' : 'transparent', color: view === 'cert' ? '#c8d4a0' : '#6b7a5a' }}>Cert</button>
            <button onClick={() => setView('weed')} style={{ padding: isMobile ? '8px 10px' : '6px 12px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'weed' ? '#2a3020' : 'transparent', color: view === 'weed' ? '#c8d4a0' : '#6b7a5a' }}>Weed</button>
          </div>
          {!isMobile && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {opTypes.map(op => (
                <div key={op.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8a9a6a' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: op.color, flexShrink: 0 }} />
                  <span>{OP_ABBREV[op.name] || op.name.slice(0, 2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isMobile && (
        <div style={{ padding: '10px 32px', backgroundColor: '#0a1208', borderBottom: '1px solid #2a3020', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: '#6b7a5a' }}>John Deere Operations Center</span>
          <a href="/api/auth/jd" style={{ padding: '5px 14px', backgroundColor: '#367c2b', color: '#fff', borderRadius: '4px', fontSize: '12px', textDecoration: 'none' }}>Connect John Deere</a>
        </div>
      )}

      {!loading && acresSummary.length > 0 && view !== 'log' && view !== 'cert' && view !== 'weed' && (
        <div style={{ padding: isMobile ? '8px 16px' : '12px 32px', borderBottom: '1px solid #2a3020', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#0c1410' }}>
          {!isMobile && <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#4a5a3a' }}>{view === 'year' ? `${year}` : monthName}</div>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            {acresSummary.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', color: '#8a9a6a' }}>{OP_ABBREV[s.name] || s.name.slice(0,2)}:</span>
                <span style={{ fontSize: '11px', color: '#c8d4a0', fontWeight: 'bold' }}>{s.totalAcres.toLocaleString('en-US', { maximumFractionDigits: 0 })}ac</span>
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#c8d4a0' }}>
            <strong>{totalAcresWorked.toLocaleString('en-US', { maximumFractionDigits: 0 })} ac</strong>
          </div>
        </div>
      )}

      {view !== 'log' && view !== 'map' && view !== 'cert' && view !== 'weed' && (
        <div style={{ padding: isMobile ? '10px 16px' : '16px 32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {view === 'year' ? (
            <>
              <button onClick={() => setYear(y => y - 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '8px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px' }}>‹</button>
              <span style={{ fontSize: '18px', color: '#c8d4a0', minWidth: '80px', textAlign: 'center' }}>{year}</span>
              <button onClick={() => setYear(y => y + 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '8px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px' }}>›</button>
            </>
          ) : (
            <>
              <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '8px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px' }}>‹</button>
              <span style={{ fontSize: isMobile ? '16px' : '18px', color: '#c8d4a0', minWidth: isMobile ? '130px' : '200px', textAlign: 'center' }}>{monthName}</span>
              <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '8px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px' }}>›</button>
            </>
          )}
        </div>
      )}

      {loading && <div style={{ padding: '40px 16px', color: '#6b7a5a', fontSize: '14px', textAlign: 'center' }}>Loading field data...</div>}

      {/* Recent Log View */}
      {!loading && view === 'log' && (
        <div style={{ padding: isMobile ? '12px 16px' : '16px 32px' }}>
          <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '12px' }}>Recent Operations</div>
          {operations.length === 0 && <div style={{ color: '#6b7a5a', fontSize: '14px' }}>No operations logged yet.</div>}
          {operations.map(op => {
            const field = fields.find(f => f.id === op.field_id)
            return (
              <div key={op.id} onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field?.name || '' }) }}
                style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '8px', padding: '14px 16px', marginBottom: '10px', cursor: 'pointer', borderLeft: `4px solid ${op.operation_types?.color || '#666'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: isMobile ? '15px' : '14px', color: '#c8d4a0', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field?.name}</span>
                      <span style={{ fontSize: '9px', color: '#6b7a5a', flexShrink: 0 }}>{certBadge(field?.cert_status || null)}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#8a9a6a' }}>{op.operation_types?.name}</div>
                    {op.notes && <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '3px', fontStyle: 'italic' }}>{op.notes}</div>}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7a5a', textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
                    <div>{new Date(op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    <div style={{ fontSize: '11px' }}>{field?.acres}ac</div>
                    {field?.client === 'LB Pork' && <div style={{ fontSize: '10px', color: '#4a6a8a' }}>LB Pork</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Cert View */}
      {!loading && view === 'cert' && (
        <div style={{ padding: isMobile ? '12px 16px' : '24px 32px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {certTotals.map(g => (
              <div key={g.key} style={{ backgroundColor: '#111612', border: `1px solid ${g.color}44`, borderRadius: '8px', padding: '14px 16px', minWidth: isMobile ? '130px' : '160px', flex: '1' }}>
                <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: g.color, marginBottom: '6px' }}>{g.badge}</div>
                <div style={{ fontSize: '22px', color: '#c8d4a0' }}>{g.count}</div>
                <div style={{ fontSize: '11px', color: '#6b7a5a' }}>fields</div>
                <div style={{ fontSize: '13px', color: '#a8b888', marginTop: '2px' }}>{g.totalAcres.toLocaleString('en-US', { maximumFractionDigits: 0 })} ac</div>
              </div>
            ))}
          </div>
          {CERT_GROUPS.map(g => {
            const groupFields = fields.filter(f => (f.cert_status || 'Conventional') === g.key).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            if (groupFields.length === 0) return null
            return (
              <div key={g.key} style={{ marginBottom: '28px' }}>
                <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: g.color, marginBottom: '10px', borderBottom: `1px solid ${g.color}33`, paddingBottom: '6px' }}>
                  {g.badge} — {g.label} ({groupFields.length})
                </div>
                {isMobile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {groupFields.map(field => (
                      <div key={field.id} style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '6px', padding: '12px 14px', borderLeft: `3px solid ${g.color}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <span onClick={() => goToFieldOnMap(field.id)} style={{ fontSize: '14px', color: '#c8d4a0', cursor: 'pointer', borderBottom: '1px dotted #4a5a3a' }}>{field.name}</span>
                          <button onClick={() => openCertEdit(field)} style={{ padding: '4px 10px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }}>Edit</button>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#6b7a5a' }}>
                          {field.acres && <span>{field.acres}ac</span>}
                          {field.cert_transition_start && <span>Trans: {new Date(field.cert_transition_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                          {field.cert_expiry && <span style={{ color: new Date(field.cert_expiry) < new Date() ? '#ff6b6b' : '#a8b888' }}>Exp: {new Date(field.cert_expiry + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                        </div>
                        {field.cert_notes && <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px', fontStyle: 'italic' }}>{field.cert_notes}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Field', 'Client', 'Acres', 'Trans. Start', 'Cert Expiry', 'Notes', ''].map(h => (
                          <th key={h} style={{ textAlign: h === 'Acres' ? 'right' : 'left', padding: '6px 12px', fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a2016' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupFields.map((field, fi) => (
                        <tr key={field.id} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                          <td style={{ padding: '8px 12px', fontSize: '13px', color: '#a8b888', borderBottom: '1px solid #1a2016' }}>
                            <span onClick={() => goToFieldOnMap(field.id)} style={{ cursor: 'pointer', borderBottom: '1px dotted #4a5a3a' }}>{field.name}</span>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: '12px', color: '#6b7a5a', borderBottom: '1px solid #1a2016' }}>{field.client || 'Ufer Farms'}</td>
                          <td style={{ padding: '8px 12px', fontSize: '12px', color: '#6b7a5a', borderBottom: '1px solid #1a2016', textAlign: 'right' }}>{field.acres || '—'}</td>
                          <td style={{ padding: '8px 12px', fontSize: '12px', color: '#6b7a5a', borderBottom: '1px solid #1a2016' }}>
                            {field.cert_transition_start ? new Date(field.cert_transition_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: '12px', borderBottom: '1px solid #1a2016' }}>
                            {field.cert_expiry ? <span style={{ color: new Date(field.cert_expiry) < new Date() ? '#ff6b6b' : '#a8b888' }}>{new Date(field.cert_expiry + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span> : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: '11px', color: '#6b7a5a', borderBottom: '1px solid #1a2016', fontStyle: 'italic', maxWidth: '200px' }}>{field.cert_notes || '—'}</td>
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid #1a2016' }}>
                            <button onClick={() => openCertEdit(field)} style={{ padding: '4px 10px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Weeding Action Plan View */}
      {!loading && view === 'weed' && (
        <div style={{ padding: isMobile ? '12px 16px' : '24px 32px' }}>
          <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a' }}>
              Weeding Action Plan — {weedingFields.length} fields in crop
            </div>
            <div style={{ fontSize: '11px', color: '#4a5a3a' }}>Priority sorted by GDUs since last tillage ↓</div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px', padding: '10px 16px', backgroundColor: '#111612', borderRadius: '6px', border: '1px solid #2a3020' }}>
            {ACTION_THRESHOLDS.map(t => (
              <div key={t.gdu} style={{ fontSize: '11px', color: '#6b7a5a' }}>
                <span style={{ color: '#a8b888' }}>{t.stage}</span> at {t.gdu} GDU → <span style={{ color: '#c8d4a0' }}>{t.action}</span>
              </div>
            ))}
          </div>

          {['North', 'South'].map(region => {
            const regionFields = weedingFields.filter(f => f.region === region)
            if (regionFields.length === 0) return null

            // Group by crop type
            const cropGroups: Record<string, typeof regionFields> = {}
            for (const f of regionFields) {
              const crop = f.cropType || 'Unknown'
              if (!cropGroups[crop]) cropGroups[crop] = []
              cropGroups[crop].push(f)
            }

            return (
              <div key={region} style={{ marginBottom: '32px' }}>
                <div style={{ fontSize: '12px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8a9a6a', marginBottom: '16px', borderBottom: '1px solid #2a3020', paddingBottom: '8px' }}>
                  {region}ern Operation — {regionFields.length} fields
                </div>

                {Object.entries(cropGroups).map(([cropType, cropFields]) => {
                  // Sort by GDUs since last tillage descending (highest = most urgent)
                  const sorted = [...cropFields].sort((a, b) => (b.gduSinceLastTillage ?? 0) - (a.gduSinceLastTillage ?? 0))
                  return (
                    <div key={cropType} style={{ marginBottom: '24px' }}>
                      <div style={{ fontSize: '11px', color: '#cc8800', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                        {cropType} ({cropFields.length} fields)
                      </div>
                      {isMobile ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {sorted.map((f, i) => {
                            const gdu = f.cumulativeGDU || 0
                            const stage = getGrowthStage(gdu)
                            const nextAction = getNextAction(gdu)
                            const forecast = nextAction ? getForecastDate(gdu, nextAction.threshold, f.id) : null
                            return (
                              <div key={f.id} style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '6px', padding: '12px 14px', borderLeft: `3px solid ${i === 0 ? '#ff6b6b' : i < 3 ? '#ffaa44' : '#4a5a3a'}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <span style={{ fontSize: '14px', color: '#c8d4a0' }}>{f.name}</span>
                                  <span style={{ fontSize: '11px', color: '#cc8800', fontWeight: 'bold' }}>{f.gduSinceLastTillage ?? '—'} GDU↑</span>
                                </div>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#8a9a6a' }}>
                                  <span>{Math.round(gdu)} GDU total</span>
                                  <span style={{ color: '#c8d4a0' }}>{stage}</span>
                                  {nextAction && <span>→ {nextAction.action}</span>}
                                  {forecast && <span style={{ color: '#aad4ff' }}>~{forecast}</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              {['#', 'Field', 'Acres', 'Cert', 'GDU Since Plant', 'Stage', 'Last Tillage', 'GDU Since Tillage ↓', 'Next Action', 'Forecast'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '5px 10px', fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a2016' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((f, i) => {
                              const gdu = f.cumulativeGDU || 0
                              const stage = getGrowthStage(gdu)
                              const nextAction = getNextAction(gdu)
                              const forecast = nextAction ? getForecastDate(gdu, nextAction.threshold, f.id) : null
                              const priority = i === 0 ? '#ff6b6b' : i < 3 ? '#ffaa44' : '#6b7a5a'
                              return (
                                <tr key={f.id} style={{ backgroundColor: i % 2 === 0 ? '#111612' : '#0f1410' }}>
                                  <td style={{ padding: '7px 10px', fontSize: '11px', color: priority, borderBottom: '1px solid #1a2016', fontWeight: 'bold' }}>{i + 1}</td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#a8b888', borderBottom: '1px solid #1a2016' }}>
                                    <span onClick={() => goToFieldOnMap(f.id)} style={{ cursor: 'pointer', borderBottom: '1px dotted #4a5a3a' }}>{f.name}</span>
                                  </td>
                                  <td style={{ padding: '7px 10px', fontSize: '11px', color: '#6b7a5a', borderBottom: '1px solid #1a2016' }}>{f.acres}</td>
                                  <td style={{ padding: '7px 10px', fontSize: '11px', color: '#6b7a5a', borderBottom: '1px solid #1a2016' }}>{certBadge(f.cert_status)}</td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#c8d4a0', borderBottom: '1px solid #1a2016' }}>{Math.round(gdu)}</td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#8a9a6a', borderBottom: '1px solid #1a2016' }}>{stage}</td>
                                  <td style={{ padding: '7px 10px', fontSize: '11px', color: '#6b7a5a', borderBottom: '1px solid #1a2016' }}>
                                    {f.lastTillageOpName ? (OP_ABBREV[f.lastTillageOpName] || f.lastTillageOpName) : '—'}
                                  </td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#cc8800', borderBottom: '1px solid #1a2016', fontWeight: 'bold' }}>
                                    {f.gduSinceLastTillage !== undefined ? f.gduSinceLastTillage : '—'}
                                  </td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#c8d4a0', borderBottom: '1px solid #1a2016' }}>
                                    {nextAction ? nextAction.action : 'Beyond V6'}
                                  </td>
                                  <td style={{ padding: '7px 10px', fontSize: '12px', color: '#aad4ff', borderBottom: '1px solid #1a2016' }}>
                                    {forecast || '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {weedingFields.length === 0 && (
            <div style={{ color: '#6b7a5a', fontSize: '14px', textAlign: 'center', padding: '40px' }}>
              No fields currently in crop with GDU data. Fields appear here after seeding operations are synced from John Deere.
            </div>
          )}
        </div>
      )}

      {/* Year View */}
      {!loading && view === 'year' && fields.length > 0 && (
        <div style={{ padding: '0 32px 32px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ width: '200px', padding: '8px 12px', textAlign: 'left', fontSize: '11px', letterSpacing: '0.15em', color: '#6b7a5a', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0f1410' }}>Field</th>
                {MONTHS.map((m, i) => (
                  <th key={m} style={{ padding: '8px 4px', textAlign: 'center', fontSize: '11px', color: i === currentMonth && year === currentYear ? '#c8d4a0' : '#6b7a5a', borderBottom: '1px solid #2a3020', borderLeft: i === currentMonth && year === currentYear ? '2px solid #c8d4a040' : undefined, fontWeight: i === currentMonth && year === currentYear ? 'bold' : 'normal' }}>{m}</th>
                ))}
              </tr>
              {/* Cumulative GDU header rows */}
              <tr style={{ backgroundColor: '#080d08' }}>
                <td style={{ padding: '2px 12px', fontSize: '9px', color: '#3a6a3a', position: 'sticky', left: 0, backgroundColor: '#080d08', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a2016' }}>Cumul GDU N</td>
                {MONTHS.map((m, mi) => {
                  const v = getCumulativeGDUForMonth(mi, 'North')
                  return <td key={m} style={cumulCellStyle(v !== null)}>{v !== null ? v : ''}</td>
                })}
              </tr>
              <tr style={{ backgroundColor: '#080d08' }}>
                <td style={{ padding: '2px 12px', fontSize: '9px', color: '#3a6a3a', position: 'sticky', left: 0, backgroundColor: '#080d08', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #2a3020' }}>Cumul GDU S</td>
                {MONTHS.map((m, mi) => {
                  const v = getCumulativeGDUForMonth(mi, 'South')
                  return <td key={m} style={cumulCellStyle(v !== null)}>{v !== null ? v : ''}</td>
                })}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(({ label, filter }) => {
                const collapsed = collapsedSections[label]
                const sectionFields = fields.filter(filter)
                const isLBPork = label === 'LB Pork'
                const region = label.includes('Northern') ? 'North' : 'South'
                return (
                  <React.Fragment key={label}>
                    <tr onClick={() => toggleSection(label)}>
                      <td colSpan={13} style={sectionHeaderStyle}>
                        <span style={{ fontSize: '12px' }}>{collapsed ? '▶' : '▼'}</span>
                        {label}
                        <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>({sectionFields.length})</span>
                      </td>
                    </tr>
                    {!collapsed && sectionFields.map((field, fi) => (
                      <tr key={field.id} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                        <td style={{ padding: '6px 12px', fontSize: '12px', color: '#a8b888', borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap', position: 'sticky', left: 0, backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                          <FieldNameCell field={field} />
                        </td>
                        {MONTHS.map((m, mi) => {
                          const monthOps = getOpsForMonth(field.id, mi)
                          const isCurrentMonth = mi === currentMonth && year === currentYear
                          return (
                            <td key={m} style={{ padding: '4px 2px', textAlign: 'center', borderBottom: '1px solid #1a2016', borderLeft: isCurrentMonth ? '2px solid #c8d4a020' : undefined, minWidth: '48px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'center' }}>
                                {monthOps.map(op => (
                                  <div key={op.id} onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                    title={`${op.operation_types?.name} — ${new Date(op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                    style={{ width: '18px', height: '16px', borderRadius: '2px', backgroundColor: op.operation_types?.color || '#666', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: '#fff', fontWeight: 'bold' }}>
                                    {OP_ABBREV[op.operation_types?.name || ''] || op.operation_types?.name?.slice(0, 1) || '?'}
                                  </div>
                                ))}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {!collapsed && !isLBPork && (
                      <tr style={{ backgroundColor: '#0a0f0b' }}>
                        <td style={{ padding: '3px 12px', fontSize: '9px', color: '#4a6a4a', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0a0f0b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                          GDU avg ({region})
                        </td>
                        {MONTHS.map((m, mi) => {
                          const gdu = getGDUForMonth(mi, region as 'North' | 'South')
                          return <td key={m} style={gduCellStyle(gdu !== null)}>{gdu !== null ? gdu : ''}</td>
                        })}
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Map View */}
      {!loading && view === 'map' && (
        <div style={{ padding: isMobile ? '12px 16px' : '0 32px 32px' }}>
          <div style={{ marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: '1px solid #2a3020', borderRadius: '4px', overflow: 'hidden' }}>
              <button onClick={() => setMapMode('work')} style={{ padding: isMobile ? '8px 12px' : '5px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: mapMode === 'work' ? '#2a3020' : 'transparent', color: mapMode === 'work' ? '#c8d4a0' : '#6b7a5a' }}>Field Activity</button>
              <button onClick={() => setMapMode('daily')} style={{ padding: isMobile ? '8px 12px' : '5px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: mapMode === 'daily' ? '#2a3020' : 'transparent', color: mapMode === 'daily' ? '#c8d4a0' : '#6b7a5a' }}>Daily (In Crop)</button>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {(mapMode === 'work' ? [
                { label: 'Today', color: '#0000ff' }, { label: '1-6d', color: '#0033ff' },
                { label: '7-12d', color: '#0099ff' }, { label: '22-30d', color: '#446611' },
                { label: '40+d', color: '#ff0000' }, { label: 'Never', color: '#1a0000' },
              ] : [
                { label: 'Today', color: '#4B0082' }, { label: '2d', color: '#008000' },
                { label: '4d', color: '#ffa500' }, { label: '7+d', color: '#ff0000' },
              ]).map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8a9a6a' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: item.color }} />
                  {item.label}
                </div>
              ))}
            </div>
            {focusFieldId && <button onClick={() => setFocusFieldId(null)} style={{ marginLeft: 'auto', padding: '6px 12px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Reset</button>}
          </div>
          <FieldMap fields={heatMapFields} focusFieldId={focusFieldId} mode={mapMode} />
        </div>
      )}

      {/* Month Calendar View */}
      {!loading && view === 'calendar' && fields.length > 0 && (
        <div style={{ padding: '0 32px 32px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${daysInMonth * 36 + 180}px` }}>
            <thead>
              <tr>
                <th style={{ width: '180px', padding: '8px 12px', textAlign: 'left', fontSize: '11px', letterSpacing: '0.15em', color: '#6b7a5a', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0f1410' }}>Field</th>
                {days.map(day => {
                  const weekday = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)
                  const isToday = day === today && month === currentMonth && year === currentYear
                  const weekend = isWeekend(year, month, day)
                  return (
                    <th key={day} style={{ width: '36px', padding: '4px 2px', textAlign: 'center', fontSize: '10px', color: weekend ? '#4a5a3a' : '#6b7a5a', borderBottom: '1px solid #2a3020', borderLeft: isToday ? '2px solid #c8d4a0' : undefined, backgroundColor: isToday ? '#1a2016' : undefined }}>
                      <div>{weekday}</div>
                      <div style={{ fontSize: '11px', color: isToday ? '#c8d4a0' : undefined, fontWeight: isToday ? 'bold' : 'normal' }}>{day}</div>
                    </th>
                  )
                })}
              </tr>
              {/* Cumulative GDU header rows */}
              <tr style={{ backgroundColor: '#080d08' }}>
                <td style={{ padding: '2px 12px', fontSize: '9px', color: '#3a6a3a', position: 'sticky', left: 0, backgroundColor: '#080d08', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap' }}>Cumul GDU N</td>
                {days.map(day => {
                  const v = getCumulativeGDUForDay(day, 'North')
                  return <td key={day} style={cumulCellStyle(v !== null)}>{v !== null ? v : ''}</td>
                })}
              </tr>
              <tr style={{ backgroundColor: '#080d08' }}>
                <td style={{ padding: '2px 12px', fontSize: '9px', color: '#3a6a3a', position: 'sticky', left: 0, backgroundColor: '#080d08', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', whiteSpace: 'nowrap' }}>Cumul GDU S</td>
                {days.map(day => {
                  const v = getCumulativeGDUForDay(day, 'South')
                  return <td key={day} style={cumulCellStyle(v !== null)}>{v !== null ? v : ''}</td>
                })}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(({ label, filter }) => {
                const collapsed = collapsedSections[label]
                const sectionFields = fields.filter(filter)
                const isLBPork = label === 'LB Pork'
                const region = label.includes('Northern') ? 'North' : 'South'
                return (
                  <React.Fragment key={label}>
                    <tr onClick={() => toggleSection(label)}>
                      <td colSpan={daysInMonth + 1} style={sectionHeaderStyle}>
                        <span style={{ fontSize: '12px' }}>{collapsed ? '▶' : '▼'}</span>
                        {label}
                        <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>({sectionFields.length})</span>
                      </td>
                    </tr>
                    {!collapsed && sectionFields.map((field, fi) => (
                      <tr key={field.id} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                        <td style={{ padding: '6px 12px', fontSize: '13px', color: '#a8b888', borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap', position: 'sticky', left: 0, backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                          <FieldNameCell field={field} />
                        </td>
                        {days.map(day => {
                          const op = getOperation(field.id, day)
                          const isToday = day === today && month === currentMonth && year === currentYear
                          const weekend = isWeekend(year, month, day)
                          return (
                            <td key={day} style={{ padding: '3px 2px', textAlign: 'center', borderBottom: '1px solid #1a2016', borderLeft: isToday ? '2px solid #c8d4a04a' : undefined, backgroundColor: weekend ? '#0d1009' : undefined }}>
                              {op && (
                                <div onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                  title={op.operation_types?.name}
                                  style={{ backgroundColor: op.operation_types?.color || '#666', color: '#fff', width: '28px', height: '22px', borderRadius: '3px', margin: '0 auto', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.05em', cursor: 'pointer', fontWeight: 'bold' }}>
                                  {OP_ABBREV[op.operation_types?.name || ''] || op.operation_types?.name?.slice(0, 2).toUpperCase() || '?'}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {!collapsed && !isLBPork && (
                      <tr style={{ backgroundColor: '#0a0f0b' }}>
                        <td style={{ padding: '3px 12px', fontSize: '9px', color: '#4a6a4a', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0a0f0b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                          GDU avg
                        </td>
                        {days.map(day => {
                          const gdu = getGDUForDay(day, region as 'North' | 'South')
                          return <td key={day} style={gduCellStyle(gdu !== null)}>{gdu !== null ? gdu : ''}</td>
                        })}
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Operation Popup */}
      {selectedOp && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '8px', padding: '20px', zIndex: 999, minWidth: '240px', width: isMobile ? '88vw' : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
          <div style={{ fontSize: isMobile ? '16px' : '14px', color: '#c8d4a0', marginBottom: '6px', fontWeight: 'bold' }}>{selectedOp.fieldName}</div>
          <div style={{ fontSize: '14px', color: '#8a9a6a', marginBottom: '4px' }}>{selectedOp.op.operation_types?.name}</div>
          <div style={{ fontSize: '13px', color: '#6b7a5a', marginBottom: '14px' }}>
            {new Date(selectedOp.op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {selectedOp.op.notes && <div style={{ fontSize: '12px', color: '#6b7a5a', marginBottom: '14px', fontStyle: 'italic' }}>{selectedOp.op.notes}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setEditOp(selectedOp.op); setSelectedOp(null) }} style={{ padding: isMobile ? '10px 16px' : '7px 14px', backgroundColor: '#1a2a3a', border: 'none', color: '#aac8ff', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '14px' : '13px', flex: 1 }}>Edit</button>
            <button onClick={handleDelete} disabled={deleting} style={{ padding: isMobile ? '10px 16px' : '7px 14px', backgroundColor: '#6b1a1a', border: 'none', color: '#ffaaaa', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '14px' : '13px', flex: 1 }}>{deleting ? '...' : 'Delete'}</button>
            <button onClick={() => setSelectedOp(null)} style={{ padding: isMobile ? '10px 16px' : '7px 14px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '14px' : '13px', flex: 1 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Cert Edit Modal */}
      {editingField && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: isMobile ? '16px' : '0' }}>
          <div style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '8px', padding: '24px', width: '100%', maxWidth: '480px' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 'normal', color: '#c8d4a0', fontFamily: 'Georgia, serif' }}>Edit Certification</h2>
            <div style={{ fontSize: '13px', color: '#6b7a5a', marginBottom: '20px' }}>{editingField.name}</div>
            {[
              { label: 'Status', content: <select value={certEdit.status} onChange={e => setCertEdit(p => ({ ...p, status: e.target.value }))} style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f1410', border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px', fontSize: '15px' }}><option value="Certified">Certified Organic</option><option value="Transition 2">Transition 2</option><option value="Transition 1">Transition 1</option><option value="Conventional">Conventional</option></select> },
              { label: 'Transition Start Date', content: <input type="date" value={certEdit.transition_start} onChange={e => setCertEdit(p => ({ ...p, transition_start: e.target.value }))} style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f1410', border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px', fontSize: '15px', boxSizing: 'border-box' as const }} /> },
              { label: 'Certification Expiry Date', content: <input type="date" value={certEdit.expiry} onChange={e => setCertEdit(p => ({ ...p, expiry: e.target.value }))} style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f1410', border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px', fontSize: '15px', boxSizing: 'border-box' as const }} /> },
              { label: 'Notes', content: <textarea value={certEdit.notes} onChange={e => setCertEdit(p => ({ ...p, notes: e.target.value }))} rows={3} style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f1410', border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box' as const, fontFamily: 'Georgia, serif' }} /> },
            ].map(({ label, content }) => (
              <div key={label} style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>{label}</label>
                {content}
              </div>
            ))}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button onClick={() => setEditingField(null)} style={{ padding: '10px 20px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>Cancel</button>
              <button onClick={saveCert} disabled={savingCert} style={{ padding: '10px 20px', backgroundColor: '#2d6a2d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>{savingCert ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showModal && <AddOperationModal fields={fields} opTypes={opTypes} onClose={() => setShowModal(false)} onSaved={onSaved} />}
      {editOp && <AddOperationModal fields={fields} opTypes={opTypes} onClose={() => setEditOp(null)} onSaved={onSaved}
        editOperation={{ id: editOp.id, field_id: editOp.field_id, operation_type_id: editOp.operation_type_id, date: editOp.date, notes: editOp.notes || '' }} />}
    </div>
  )
}
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
}
type OperationType = { id: string; name: string; color: string }
type Operation = {
  id: string
  date: string
  field_id: string
  operation_type_id: string
  notes: string
  source: string
  fields: { name: string }
  operation_types: { name: string; color: string }
}

type SelectedOp = {
  op: Operation
  fieldName: string
}

const SECTIONS = [
  { label: 'Northern Operation', filter: (f: Field) => f.region === 'North' && f.client !== 'LB Pork' },
  { label: 'Southern Operation', filter: (f: Field) => f.region === 'South' && f.client !== 'LB Pork' },
  { label: 'LB Pork', filter: (f: Field) => f.client === 'LB Pork' },
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
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'calendar' | 'year' | 'map' | 'log'>('calendar')
  const [mapMode, setMapMode] = useState<'work' | 'daily'>('work')
  const [showModal, setShowModal] = useState(false)
  const [editOp, setEditOp] = useState<Operation | null>(null)
  const [selectedOp, setSelectedOp] = useState<SelectedOp | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null)

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
      const { data: opsData } = await supabaseClient
        .from('operations')
        .select('*, fields(name), operation_types(name, color)')
        .gte('date', startDate)
        .lte('date', endDate)
      const { data: allOpsData } = await supabaseClient
        .from('operations')
        .select('*, operation_types(name, color)')
        .order('date', { ascending: false })
      setFields(fieldsData || [])
      setOperations(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function loadYearData() {
    setLoading(true)
    try {
      const [fieldsData, opTypesData] = await Promise.all([getFields(), getOperationTypes()])
      const { data: opsData } = await supabaseClient
        .from('operations')
        .select('*, fields(name), operation_types(name, color)')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
      const { data: allOpsData } = await supabaseClient
        .from('operations')
        .select('*, operation_types(name, color)')
        .order('date', { ascending: false })
      setFields(fieldsData || [])
      setAllYearOps(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function loadLogData() {
    setLoading(true)
    try {
      const [fieldsData, opTypesData] = await Promise.all([getFields(), getOperationTypes()])
      const { data: opsData } = await supabaseClient
        .from('operations')
        .select('*, fields(name), operation_types(name, color)')
        .order('date', { ascending: false })
        .limit(100)
      const { data: allOpsData } = await supabaseClient
        .from('operations')
        .select('*, operation_types(name, color)')
        .order('date', { ascending: false })
      setFields(fieldsData || [])
      setOperations(opsData || [])
      setAllOps(allOpsData || [])
      setOpTypes(opTypesData || [])
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
    const totalAcres = uniqueFieldIds.reduce((sum, fid) => {
      const field = fields.find(f => f.id === fid)
      return sum + (field?.acres || 0)
    }, 0)
    return { ...ot, totalAcres, count: opsOfType.length }
  }).filter(s => s.count > 0)

  const totalAcresWorked = acresSummary.reduce((sum, s) => sum + s.totalAcres, 0)

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
    return allYearOps.filter(op => {
      const d = new Date(op.date + 'T12:00:00')
      return op.field_id === fieldId && d.getMonth() === m
    })
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function exportToCSV() {
    if (activeOps.length === 0) return
    const rows = activeOps.map(op => {
      const field = fields.find(f => f.id === op.field_id)
      return [
        new Date(op.date + 'T12:00:00').toLocaleDateString('en-US'),
        field?.name || '', field?.region || '', field?.client || '',
        field?.cert_status || '', field?.acres || '',
        op.operation_types?.name || '', op.notes || '', op.source || 'manual'
      ]
    })
    const headers = ['Date', 'Field', 'Region', 'Client', 'Cert Status', 'Acres', 'Operation Type', 'Notes', 'Source']
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `field-ops-${view === 'year' ? year : `${year}-${String(month + 1).padStart(2, '0')}`}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fieldsWithHeat = fields.map(f => {
    const fieldOps = allOps
      .filter(op => op.field_id === f.id && op.date >= `${currentYear}-01-01`)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const latest = fieldOps[0]
    const daysSinceWork = latest ? daysSince(latest.date) : undefined

    const lastSeeding = fieldOps.find(op => op.operation_types?.name === 'Seeding')
    const lastHarvest = fieldOps.find(op => op.operation_types?.name === 'Harvest')

    const isInCrop = lastSeeding ? (
      !lastHarvest || new Date(lastSeeding.date) > new Date(lastHarvest.date)
    ) : false

    return { ...f, daysSinceWork, isInCrop }
  })

  const heatMapFields = mapMode === 'daily'
    ? fieldsWithHeat.filter(f => f.isInCrop)
    : fieldsWithHeat

  const onSaved = () => {
    setShowModal(false)
    setEditOp(null)
    if (view === 'year') loadYearData()
    else if (view === 'log') loadLogData()
    else loadData()
  }

  const sectionHeaderStyle = {
    padding: '6px 12px',
    fontSize: '10px',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: '#8a9a6a',
    backgroundColor: '#0a0f0b',
    borderBottom: '1px solid #2a3020',
    cursor: 'pointer',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }

  const fieldNameStyle = {
    cursor: 'pointer',
    borderBottom: '1px dotted #4a5a3a',
    color: '#a8b888',
  }

  function FieldNameCell({ field }: { field: Field }) {
    return (
      <>
        <span
          onClick={e => { e.stopPropagation(); goToFieldOnMap(field.id) }}
          style={fieldNameStyle}
          title="View on heat map"
        >
          {field.name}
        </span>
        <span style={{ fontSize: '9px', color: '#6b7a5a', marginLeft: '5px' }}>
          {certBadge(field.cert_status)}
        </span>
        {field.acres && <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>{field.acres}ac</span>}
      </>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1410', color: '#e8ead5', fontFamily: "'Georgia', serif" }}
      onClick={() => setSelectedOp(null)}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a3020', padding: isMobile ? '12px 16px' : '16px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? '10px' : '0' }}>
          <div>
            {!isMobile && <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#6b7a5a', textTransform: 'uppercase', marginBottom: '4px' }}>Field Operations Manager</div>}
            <h1 style={{ fontSize: isMobile ? '18px' : '24px', fontWeight: 'normal', margin: 0, color: '#c8d4a0' }}>
              {isMobile ? 'Field Ops' : 'Activity Calendar'}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setShowModal(true)} style={{ padding: '8px 14px', backgroundColor: '#2d6a2d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '14px' : '12px' }}>+ Log</button>
            {!isMobile && (
              <>
                <button onClick={exportToCSV} style={{ padding: '6px 16px', background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>↓ CSV</button>
                <button onClick={handleSignOut} style={{ padding: '6px 14px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Sign Out</button>
              </>
            )}
            {isMobile && (
              <button onClick={handleSignOut} style={{ padding: '8px 12px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>Out</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0', marginTop: isMobile ? '0' : '12px' }}>
          <div style={{ display: 'flex', border: '1px solid #2a3020', borderRadius: '4px', overflow: 'hidden' }}>
            {isMobile && (
              <button onClick={() => setView('log')} style={{ padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'log' ? '#2a3020' : 'transparent', color: view === 'log' ? '#c8d4a0' : '#6b7a5a' }}>Recent</button>
            )}
            <button onClick={() => setView('calendar')} style={{ padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'calendar' ? '#2a3020' : 'transparent', color: view === 'calendar' ? '#c8d4a0' : '#6b7a5a' }}>Month</button>
            <button onClick={() => setView('year')} style={{ padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'year' ? '#2a3020' : 'transparent', color: view === 'year' ? '#c8d4a0' : '#6b7a5a' }}>Year</button>
            <button onClick={() => setView('map')} style={{ padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: view === 'map' ? '#2a3020' : 'transparent', color: view === 'map' ? '#c8d4a0' : '#6b7a5a' }}>Map</button>
          </div>
          {!isMobile && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {opTypes.map(op => (
                <div key={op.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#8a9a6a' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: op.color }} />
                  {op.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* JD Connect Banner */}
      {!isMobile && (
        <div style={{ padding: '10px 32px', backgroundColor: '#0a1208', borderBottom: '1px solid #2a3020', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: '#6b7a5a' }}>John Deere Operations Center</span>
          <a href="/api/auth/jd" style={{ padding: '5px 14px', backgroundColor: '#367c2b', color: '#fff', borderRadius: '4px', fontSize: '12px', textDecoration: 'none' }}>Connect John Deere</a>
        </div>
      )}

      {/* Stats Bar */}
      {!loading && acresSummary.length > 0 && view !== 'log' && (
        <div style={{ padding: isMobile ? '10px 16px' : '12px 32px', borderBottom: '1px solid #2a3020', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#0c1410' }}>
          {!isMobile && <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#4a5a3a' }}>{view === 'year' ? `${year}` : monthName}</div>}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            {acresSummary.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: s.color }} />
                <span style={{ fontSize: '11px', color: '#8a9a6a' }}>{s.name.replace('Tillage - ', '').replace('Application - ', '')}:</span>
                <span style={{ fontSize: '11px', color: '#c8d4a0', fontWeight: 'bold' }}>{s.totalAcres.toLocaleString('en-US', { maximumFractionDigits: 0 })}ac</span>
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#c8d4a0' }}>
            Total: <strong>{totalAcresWorked.toLocaleString('en-US', { maximumFractionDigits: 0 })} ac</strong>
          </div>
        </div>
      )}

      {/* Nav */}
      {view !== 'log' && view !== 'map' && (
        <div style={{ padding: isMobile ? '12px 16px' : '16px 32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {view === 'year' ? (
            <>
              <button onClick={() => setYear(y => y - 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>‹</button>
              <span style={{ fontSize: '18px', color: '#c8d4a0', minWidth: '80px', textAlign: 'center' }}>{year}</span>
              <button onClick={() => setYear(y => y + 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>›</button>
            </>
          ) : (
            <>
              <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>‹</button>
              <span style={{ fontSize: isMobile ? '15px' : '18px', color: '#c8d4a0', minWidth: isMobile ? '140px' : '200px', textAlign: 'center' }}>{monthName}</span>
              <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>›</button>
            </>
          )}
        </div>
      )}

      {loading && <div style={{ padding: '40px 16px', color: '#6b7a5a', fontSize: '14px', textAlign: 'center' }}>Loading field data...</div>}

      {/* Recent Log View */}
      {!loading && view === 'log' && (
        <div style={{ padding: isMobile ? '16px' : '16px 32px' }}>
          <div style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '12px' }}>Recent Operations</div>
          {operations.length === 0 && <div style={{ color: '#6b7a5a', fontSize: '14px' }}>No operations logged yet.</div>}
          {operations.map(op => {
            const field = fields.find(f => f.id === op.field_id)
            return (
              <div key={op.id} onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field?.name || '' }) }}
                style={{ backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '6px', padding: '12px 16px', marginBottom: '8px', cursor: 'pointer', borderLeft: `4px solid ${op.operation_types?.color || '#666'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14px', color: '#c8d4a0', marginBottom: '3px' }}>
                      {field?.name}
                      <span style={{ fontSize: '9px', color: '#6b7a5a', marginLeft: '6px' }}>{certBadge(field?.cert_status || null)}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#8a9a6a' }}>{op.operation_types?.name}</div>
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
            </thead>
            <tbody>
              {SECTIONS.map(({ label, filter }) => {
                const collapsed = collapsedSections[label]
                const sectionFields = fields.filter(filter)
                return (
                  <React.Fragment key={label}>
                    <tr onClick={() => toggleSection(label)}>
                      <td colSpan={13} style={sectionHeaderStyle}>
                        <span style={{ fontSize: '12px' }}>{collapsed ? '▶' : '▼'}</span>
                        {label}
                        <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>({sectionFields.length} fields)</span>
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
                                  <div key={op.id}
                                    onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                    title={`${op.operation_types?.name} — ${new Date(op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                    style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: op.operation_types?.color || '#666', cursor: 'pointer', flexShrink: 0 }}
                                  />
                                ))}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
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
          <div style={{ marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: '1px solid #2a3020', borderRadius: '4px', overflow: 'hidden' }}>
              <button onClick={() => setMapMode('work')} style={{ padding: '5px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: mapMode === 'work' ? '#2a3020' : 'transparent', color: mapMode === 'work' ? '#c8d4a0' : '#6b7a5a' }}>Field Activity</button>
              <button onClick={() => setMapMode('daily')} style={{ padding: '5px 14px', cursor: 'pointer', fontSize: '12px', border: 'none', backgroundColor: mapMode === 'daily' ? '#2a3020' : 'transparent', color: mapMode === 'daily' ? '#c8d4a0' : '#6b7a5a' }}>Daily Activity (In Crop)</button>
            </div>
            {mapMode === 'work' ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {[
                  { label: 'Today', color: '#0000ff' },
                  { label: '1-6d', color: '#0033ff' },
                  { label: '7-12d', color: '#0099ff' },
                  { label: '13-21d', color: '#00bb88' },
                  { label: '22-30d', color: '#446611' },
                  { label: '31-39d', color: '#aa3300' },
                  { label: '40+d', color: '#ff0000' },
                  { label: 'Never', color: '#1a0000' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8a9a6a' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: item.color }} />
                    {item.label}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {[
                  { label: 'Today', color: '#4B0082' },
                  { label: '1 day', color: '#0000ff' },
                  { label: '2 days', color: '#008000' },
                  { label: '3 days', color: '#ffff00' },
                  { label: '4 days', color: '#ffa500' },
                  { label: '5 days', color: '#ff6600' },
                  { label: '6 days', color: '#ff3300' },
                  { label: '7+ days', color: '#ff0000' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#8a9a6a' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: item.color }} />
                    {item.label}
                  </div>
                ))}
                <span style={{ fontSize: '11px', color: '#4a5a3a', marginLeft: '4px' }}>
                  — {heatMapFields.filter(f => f.isInCrop).length} fields in crop
                </span>
              </div>
            )}
            {focusFieldId && (
              <button onClick={() => setFocusFieldId(null)} style={{ marginLeft: 'auto', padding: '4px 10px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Reset view</button>
            )}
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
            </thead>
            <tbody>
              {SECTIONS.map(({ label, filter }) => {
                const collapsed = collapsedSections[label]
                const sectionFields = fields.filter(filter)
                return (
                  <React.Fragment key={label}>
                    <tr onClick={() => toggleSection(label)}>
                      <td colSpan={daysInMonth + 1} style={sectionHeaderStyle}>
                        <span style={{ fontSize: '12px' }}>{collapsed ? '▶' : '▼'}</span>
                        {label}
                        <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '4px' }}>({sectionFields.length} fields)</span>
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
                                <div onClick={(e) => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                  title={op.operation_types?.name}
                                  style={{ backgroundColor: op.operation_types?.color || '#666', color: '#fff', width: '28px', height: '22px', borderRadius: '3px', margin: '0 auto', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.05em', cursor: 'pointer' }}>
                                  {op.operation_types?.name?.replace('Tillage - ', '').replace('Application - ', '').slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Operation Popup */}
      {selectedOp && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', backgroundColor: '#111612', border: '1px solid #2a3020', borderRadius: '6px', padding: '16px', zIndex: 999, minWidth: '220px', width: isMobile ? '85vw' : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
          <div style={{ fontSize: '14px', color: '#c8d4a0', marginBottom: '4px', fontWeight: 'bold' }}>{selectedOp.fieldName}</div>
          <div style={{ fontSize: '13px', color: '#8a9a6a', marginBottom: '2px' }}>{selectedOp.op.operation_types?.name}</div>
          <div style={{ fontSize: '12px', color: '#6b7a5a', marginBottom: '12px' }}>
            {new Date(selectedOp.op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {selectedOp.op.notes && <div style={{ fontSize: '12px', color: '#6b7a5a', marginBottom: '12px', fontStyle: 'italic' }}>{selectedOp.op.notes}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setEditOp(selectedOp.op); setSelectedOp(null) }} style={{ padding: '7px 14px', backgroundColor: '#1a2a3a', border: 'none', color: '#aac8ff', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>Edit</button>
            <button onClick={handleDelete} disabled={deleting} style={{ padding: '7px 14px', backgroundColor: '#6b1a1a', border: 'none', color: '#ffaaaa', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>{deleting ? '...' : 'Delete'}</button>
            <button onClick={() => setSelectedOp(null)} style={{ padding: '7px 14px', background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          </div>
        </div>
      )}

      {showModal && <AddOperationModal fields={fields} opTypes={opTypes} onClose={() => setShowModal(false)} onSaved={onSaved} />}
      {editOp && <AddOperationModal fields={fields} opTypes={opTypes} onClose={() => setEditOp(null)} onSaved={onSaved}
        editOperation={{ id: editOp.id, field_id: editOp.field_id, operation_type_id: editOp.operation_type_id, date: editOp.date, notes: editOp.notes || '' }} />}
    </div>
  )
}
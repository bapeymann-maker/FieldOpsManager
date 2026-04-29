'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

type Field = {
  id: string; name: string; acres: number | null; region: string | null;
  client: string | null; cert_status: string | null;
}

type YieldRecord = {
  id: string; field_id: string; year: number; crop_type: string;
  actual_yield: number | null; total_bushels: number | null;
  acres_harvested: number | null; avg_moisture: number | null;
  total_fuel_gal: number | null; harvest_hours: number | null;
  varieties: string | null; first_harvested: string | null;
  last_harvested: string | null;
}

type MachineSession = {
  id: string; machine_id: string; field_id: string;
  entered_at: string; exited_at: string; duration_minutes: number;
  date: string; operation_type: string | null;
  machines: { name: string; type: string | null }
}

type SortKey = 'date' | 'machine' | 'duration' | 'acres_per_hour'
type SortDir = 'asc' | 'desc'

const TRACTOR_TYPES = new Set(['Track Tractor', 'Wheel Tractor', 'Tractor'])

function certBadge(status: string | null) {
  switch (status) {
    case 'Certified': return { label: 'O', color: '#4aaa4a' }
    case 'Transition 2': return { label: 'T2', color: '#aaaa00' }
    case 'Transition 1': return { label: 'T1', color: '#cc8800' }
    default: return { label: 'CONV', color: '#6b7a5a' }
  }
}

function formatBu(n: number | null) {
  if (!n) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatYield(n: number | null) {
  if (!n || n === 0) return '—'
  return n.toFixed(1)
}

function formatDuration(minutes: number) {
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hrs === 0) return `${mins}m`
  return `${hrs}h ${mins}m`
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getOpGroup(opType: string | null): string {
  if (!opType) return 'Other'
  if (opType === 'Seeding') return 'Seeding'
  if (opType === 'Harvest') return 'Harvest'
  if (opType.startsWith('Tillage')) return 'Tillage'
  if (opType.startsWith('Application')) return 'Application'
  return 'Other'
}

function getOpGroupColor(group: string): string {
  switch (group) {
    case 'Seeding': return '#4a8a4a'
    case 'Harvest': return '#aa8833'
    case 'Tillage': return '#4a6a8a'
    case 'Application': return '#8a4a8a'
    default: return '#4a5a3a'
  }
}

function getOpColor(opType: string | null): string {
  if (!opType) return '#4a5a3a'
  if (opType === 'Seeding') return '#4a8a4a'
  if (opType === 'Harvest') return '#aa8833'
  if (opType.startsWith('Tillage')) return '#4a6a8a'
  if (opType.startsWith('Application')) return '#8a4a8a'
  return '#4a5a3a'
}

const OP_GROUP_ORDER = ['Seeding', 'Tillage', 'Harvest', 'Application', 'Other']

const tdStyle = (i: number) => ({
  padding: '8px 12px', fontSize: '12px',
  borderBottom: '1px solid #1a2016',
  backgroundColor: i % 2 === 0 ? '#111612' : '#0f1410'
})

const thBase = {
  textAlign: 'left' as const, padding: '7px 12px',
  fontSize: '10px', letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  borderBottom: '1px solid #1a2016',
  whiteSpace: 'nowrap' as const,
  userSelect: 'none' as const
}

export default function FieldAnalysis({
  field,
  onClose,
}: {
  field: Field
  onClose: () => void
}) {
  const [yields, setYields] = useState<YieldRecord[]>([])
  const [sessions, setSessions] = useState<MachineSession[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'yield' | 'machines'>('yield')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [groupBy, setGroupBy] = useState<'operation' | 'date' | 'machine'>('operation')
  const badge = certBadge(field.cert_status)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: yieldData }, { data: sessionData }] = await Promise.all([
        supabase.from('yields').select('*').eq('field_id', field.id).order('year', { ascending: false }),
        supabase.from('machine_field_sessions')
          .select('*, machines(name, type)')
          .eq('field_id', field.id)
          .order('entered_at', { ascending: false })
          .limit(200)
      ])
      setYields(yieldData || [])
      setSessions(sessionData || [])
      setLoading(false)
    }
    load()
  }, [field.id])

  const cropTypes = [...new Set(yields.map(y => y.crop_type))].sort()
  const cornYields = yields.filter(y => y.crop_type === 'Corn' && y.actual_yield && y.actual_yield > 0)
  const bestCorn = cornYields.length > 0 ? cornYields.reduce((a, b) => (a.actual_yield || 0) > (b.actual_yield || 0) ? a : b) : null
  const currentYearYield = yields.find(y => y.year === new Date().getFullYear())

  // Split sessions by machine role
  const workingSessions = sessions.filter(s => s.duration_minutes >= 20)
  const tractorSessions = workingSessions.filter(s => TRACTOR_TYPES.has(s.machines?.type || ''))
  const planterSessions = workingSessions.filter(s => s.machines?.type === 'Planter')

  // Efficiency metrics based on tractor time only (not double-counting planter)
  const totalTractorMinutes = tractorSessions.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalPlanterMinutes = planterSessions.reduce((sum, s) => sum + s.duration_minutes, 0)
  const totalMachineHours = totalTractorMinutes / 60

  // Downtime = planter time minus tractor time (turns, headlands, seed refills)
  // If planter was in field longer than tractor, that extra time = stops/refills
  const downtimeMinutes = totalPlanterMinutes > 0 && totalTractorMinutes > 0
    ? Math.max(0, totalPlanterMinutes - totalTractorMinutes)
    : null

  const uniqueMachines = [...new Set(sessions.map(s => s.machines?.name).filter(Boolean))]
  const acresPerHour = field.acres && totalMachineHours > 0
    ? Math.round((field.acres / totalMachineHours) * 10) / 10
    : null

  function getAcHr(durationMinutes: number, machineType: string | null) {
    if (!field.acres || durationMinutes < 20) return null
    // Only show ac/hr for tractors pulling equipment, not implements themselves
    if (machineType && !TRACTOR_TYPES.has(machineType)) return null
    return Math.round((field.acres / (durationMinutes / 60)) * 10) / 10
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function sortList(list: MachineSession[]) {
    return [...list].sort((a, b) => {
      if (sortKey === 'date') {
        const diff = new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
        return sortDir === 'asc' ? diff : -diff
      }
      if (sortKey === 'machine') {
        const diff = (a.machines?.name || '').localeCompare(b.machines?.name || '')
        return sortDir === 'asc' ? diff : -diff
      }
      if (sortKey === 'duration') {
        const diff = a.duration_minutes - b.duration_minutes
        return sortDir === 'asc' ? diff : -diff
      }
      if (sortKey === 'acres_per_hour') {
        const aVal = getAcHr(a.duration_minutes, a.machines?.type || null) || 0
        const bVal = getAcHr(b.duration_minutes, b.machines?.type || null) || 0
        const diff = aVal - bVal
        return sortDir === 'asc' ? diff : -diff
      }
      return 0
    })
  }

  const machineMap: Record<string, { name: string; type: string | null; totalMinutes: number; visits: number; isTractor: boolean }> = {}
  for (const s of workingSessions) {
    const mid = s.machine_id
    if (!machineMap[mid]) {
      machineMap[mid] = {
        name: s.machines?.name || mid,
        type: s.machines?.type || null,
        totalMinutes: 0, visits: 0,
        isTractor: TRACTOR_TYPES.has(s.machines?.type || '')
      }
    }
    machineMap[mid].totalMinutes += s.duration_minutes
    machineMap[mid].visits++
  }

  function SortArrow({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span style={{ color: '#2a3020', marginLeft: '4px' }}>↕</span>
    return <span style={{ color: '#c8d4a0', marginLeft: '4px' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function SessionTableHeader() {
    return (
      <thead>
        <tr>
          <th style={{ ...thBase, color: sortKey === 'date' ? '#c8d4a0' : '#4a5a3a', cursor: 'pointer' }} onClick={() => handleSort('date')}>Date <SortArrow k="date" /></th>
          <th style={{ ...thBase, color: sortKey === 'machine' ? '#c8d4a0' : '#4a5a3a', cursor: 'pointer' }} onClick={() => handleSort('machine')}>Machine <SortArrow k="machine" /></th>
          <th style={{ ...thBase, color: '#4a5a3a' }}>Operation</th>
          <th style={{ ...thBase, color: '#4a5a3a' }}>Entered</th>
          <th style={{ ...thBase, color: '#4a5a3a' }}>Exited</th>
          <th style={{ ...thBase, color: sortKey === 'duration' ? '#c8d4a0' : '#4a5a3a', cursor: 'pointer' }} onClick={() => handleSort('duration')}>Duration <SortArrow k="duration" /></th>
          <th style={{ ...thBase, color: sortKey === 'acres_per_hour' ? '#c8d4a0' : '#4a5a3a', cursor: 'pointer' }} onClick={() => handleSort('acres_per_hour')}>Ac/Hr <SortArrow k="acres_per_hour" /></th>
        </tr>
      </thead>
    )
  }

  function renderSessionRows(list: MachineSession[]) {
    const sorted = sortList(list)
    return sorted.map((session, i) => {
      const machineType = session.machines?.type || null
      const isTractor = TRACTOR_TYPES.has(machineType || '')
      const isPlanter = machineType === 'Planter'
      const acHr = getAcHr(session.duration_minutes, machineType)
      const isShort = session.duration_minutes < 20
      const opColor = getOpColor(session.operation_type)
      return (
        <tr key={session.id}>
          <td style={tdStyle(i)}>
            <span style={{ fontSize: '11px', color: '#8a9a6a' }}>{formatDateShort(session.date)}</span>
          </td>
          <td style={tdStyle(i)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: isShort ? '#4a5a3a' : '#c8d4a0' }}>{session.machines?.name || session.machine_id}</span>
              {isPlanter && <span style={{ fontSize: '9px', color: '#4a6a8a', backgroundColor: '#1a2a3a', padding: '1px 5px', borderRadius: '3px', border: '1px solid #2a4a5a' }}>IMPL</span>}
            </div>
            <div style={{ fontSize: '10px', color: '#4a5a3a', marginTop: '1px' }}>{machineType || ''}</div>
          </td>
          <td style={tdStyle(i)}>
            {session.operation_type
              ? <span style={{ fontSize: '11px', color: opColor, backgroundColor: opColor + '18', padding: '2px 7px', borderRadius: '3px', border: `1px solid ${opColor}44` }}>{session.operation_type}</span>
              : <span style={{ fontSize: '11px', color: '#4a5a3a' }}>Unknown</span>}
          </td>
          <td style={tdStyle(i)}>
            <span style={{ color: '#6b7a5a', fontSize: '11px' }}>{formatTime(session.entered_at)}</span>
          </td>
          <td style={tdStyle(i)}>
            <span style={{ color: '#6b7a5a', fontSize: '11px' }}>{formatTime(session.exited_at)}</span>
          </td>
          <td style={tdStyle(i)}>
            <span style={{ color: isShort ? '#4a5a3a' : '#a8c888' }}>{formatDuration(session.duration_minutes)}</span>
            {isShort && <span style={{ fontSize: '9px', color: '#3a4a2a', marginLeft: '4px' }}>pass</span>}
          </td>
          <td style={tdStyle(i)}>
            {acHr
              ? <span style={{ color: '#aad4ff' }}>{acHr}</span>
              : <span style={{ color: '#3a4a2a', fontSize: '11px' }}>{!isTractor ? 'impl' : '—'}</span>}
          </td>
        </tr>
      )
    })
  }

  const secStyle = { padding: '20px 28px', borderBottom: '1px solid #1a2016' }
  const secTitle = { fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: '#4a5a3a', marginBottom: '14px' }
  const statCard = { backgroundColor: '#111612', borderRadius: '6px', border: '1px solid #2a3020', padding: '14px 16px', flex: '1', minWidth: '120px' }
  const statLabel = { fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '40px 16px', overflowY: 'auto' }} onClick={onClose}>
      <div style={{ backgroundColor: '#0f1410', color: '#e8ead5', fontFamily: "'Georgia', serif", width: '100%', maxWidth: '980px', borderRadius: '8px', border: '1px solid #2a3020', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid #2a3020', backgroundColor: '#0a0f0b', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 'normal', color: '#c8d4a0' }}>{field.name}</h2>
              <span style={{ fontSize: '11px', color: badge.color, border: `1px solid ${badge.color}66`, borderRadius: '3px', padding: '2px 6px' }}>{badge.label}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7a5a', display: 'flex', gap: '16px' }}>
              {field.region && <span>{field.region}ern Operation</span>}
              {field.client && <span>{field.client}</span>}
              {field.acres && <span>{field.acres} acres</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #2a3020', color: '#6b7a5a', borderRadius: '4px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px' }}>✕ Close</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #2a3020', backgroundColor: '#0a0f0b' }}>
          <button onClick={() => setActiveTab('yield')} style={{ padding: '12px 24px', border: 'none', cursor: 'pointer', fontSize: '12px', backgroundColor: 'transparent', color: activeTab === 'yield' ? '#c8d4a0' : '#6b7a5a', borderBottom: activeTab === 'yield' ? '2px solid #4aaa4a' : '2px solid transparent' }}>
            Yield & Harvest
          </button>
          <button onClick={() => setActiveTab('machines')} style={{ padding: '12px 24px', border: 'none', cursor: 'pointer', fontSize: '12px', backgroundColor: 'transparent', color: activeTab === 'machines' ? '#c8d4a0' : '#6b7a5a', borderBottom: activeTab === 'machines' ? '2px solid #4a8aaa' : '2px solid transparent' }}>
            Machine Time {sessions.length > 0 && <span style={{ fontSize: '10px', color: '#4a6a8a', marginLeft: '6px' }}>({sessions.length})</span>}
          </button>
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>Loading field data...</div>}

        {/* Yield Tab */}
        {!loading && activeTab === 'yield' && (
          <>
            {yields.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>No yield data available for this field yet.</div>
            ) : (
              <>
                <div style={secStyle}>
                  <div style={secTitle}>2025 Summary</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {cropTypes.map(crop => {
                      const y = yields.find(y => y.year === 2025 && y.crop_type === crop)
                      if (!y) return null
                      return (
                        <div key={crop} style={statCard}>
                          <div style={statLabel}>{crop}</div>
                          <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{formatYield(y.actual_yield)}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>bu/ac</span></div>
                          <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{formatBu(y.total_bushels)} bu total</div>
                          {y.avg_moisture && <div style={{ fontSize: '11px', color: '#4a8a6a', marginTop: '2px' }}>{y.avg_moisture.toFixed(1)}% moisture</div>}
                        </div>
                      )
                    })}
                    {bestCorn && (
                      <div style={statCard}>
                        <div style={statLabel}>Best Corn Year</div>
                        <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{formatYield(bestCorn.actual_yield)}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>bu/ac</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{bestCorn.year}</div>
                      </div>
                    )}
                    {currentYearYield?.harvest_hours && (
                      <div style={statCard}>
                        <div style={statLabel}>Harvest Hours</div>
                        <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{currentYearYield.harvest_hours.toFixed(1)}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>hrs</span></div>
                        {currentYearYield.total_fuel_gal && <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{(currentYearYield.total_fuel_gal / (currentYearYield.acres_harvested || 1)).toFixed(2)} gal/ac</div>}
                      </div>
                    )}
                  </div>
                </div>

                <div style={secStyle}>
                  <div style={secTitle}>Yield History by Crop</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {cropTypes.map(crop => {
                      const cropYields = yields.filter(y => y.crop_type === crop && y.actual_yield && y.actual_yield > 0).sort((a, b) => a.year - b.year)
                      if (cropYields.length === 0) return null
                      const maxCropYield = Math.max(...cropYields.map(y => y.actual_yield || 0))
                      return (
                        <div key={crop}>
                          <div style={{ fontSize: '11px', color: '#8a9a6a', marginBottom: '8px' }}>{crop}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {cropYields.map(y => (
                              <div key={y.year} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '11px', color: '#6b7a5a', width: '36px', textAlign: 'right', flexShrink: 0 }}>{y.year}</span>
                                <div style={{ flex: 1, height: '20px', backgroundColor: '#1a2016', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${((y.actual_yield || 0) / maxCropYield) * 100}%`, backgroundColor: crop === 'Corn' ? '#8a9a4a' : crop === 'Soybeans' ? '#4a7a8a' : crop === 'Oats' ? '#aa8833' : '#6a4a8a', borderRadius: '3px' }} />
                                </div>
                                <span style={{ fontSize: '12px', color: '#c8d4a0', width: '55px', flexShrink: 0 }}>{formatYield(y.actual_yield)} bu/ac</span>
                                {y.avg_moisture && <span style={{ fontSize: '11px', color: '#4a7a6a', width: '45px', flexShrink: 0 }}>{y.avg_moisture.toFixed(1)}% H₂O</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div style={secStyle}>
                  <div style={secTitle}>Harvest Details</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Year', 'Crop', 'Yield (bu/ac)', 'Total Bu', 'Acres', 'Moisture', 'Fuel (gal)', 'Hrs', 'Varieties'].map(h => (<th key={h} style={{ ...thBase, color: '#4a5a3a' }}>{h}</th>))}</tr></thead>
                      <tbody>
                        {yields.filter(y => y.actual_yield && y.actual_yield > 0).map((y, i) => (
                          <tr key={y.id}>
                            <td style={tdStyle(i)}><span style={{ color: '#c8d4a0', fontWeight: 'bold' }}>{y.year}</span></td>
                            <td style={tdStyle(i)}>{y.crop_type}</td>
                            <td style={tdStyle(i)}><span style={{ color: '#a8c888' }}>{formatYield(y.actual_yield)}</span></td>
                            <td style={tdStyle(i)}>{formatBu(y.total_bushels)}</td>
                            <td style={tdStyle(i)}>{y.acres_harvested?.toFixed(1) || '—'}</td>
                            <td style={tdStyle(i)}>{y.avg_moisture ? `${y.avg_moisture.toFixed(1)}%` : '—'}</td>
                            <td style={tdStyle(i)}>{y.total_fuel_gal ? y.total_fuel_gal.toFixed(0) : '—'}</td>
                            <td style={tdStyle(i)}>{y.harvest_hours ? y.harvest_hours.toFixed(1) : '—'}</td>
                            <td style={{ ...tdStyle(i), fontSize: '11px', color: '#6b7a5a', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{y.varieties || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {yields.some(y => y.first_harvested) && (
                  <div style={{ ...secStyle, borderBottom: 'none' }}>
                    <div style={secTitle}>Harvest Timing</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {yields.filter(y => y.first_harvested).map(y => (
                        <div key={y.id} style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '12px' }}>
                          <span style={{ color: '#c8d4a0', width: '36px' }}>{y.year}</span>
                          <span style={{ color: '#6b7a5a', width: '80px' }}>{y.crop_type}</span>
                          <span style={{ color: '#8a9a6a' }}>
                            {new Date(y.first_harvested!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {' → '}
                            {y.last_harvested ? new Date(y.last_harvested).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                          </span>
                          {y.first_harvested && y.last_harvested && (
                            <span style={{ color: '#4a5a3a', fontSize: '11px' }}>
                              {Math.round((new Date(y.last_harvested).getTime() - new Date(y.first_harvested).getTime()) / (1000 * 60 * 60 * 24))} days
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Machine Time Tab */}
        {!loading && activeTab === 'machines' && (
          <>
            {sessions.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>No machine session data for this field yet. Run a machine sync to populate.</div>
            ) : (
              <>
                {/* Summary Cards */}
                <div style={secStyle}>
                  <div style={secTitle}>Field Efficiency Summary</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={statCard}>
                      <div style={statLabel}>Tractor Time</div>
                      <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{totalMachineHours.toFixed(1)}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>hrs</span></div>
                      <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{tractorSessions.length} tractor sessions</div>
                    </div>
                    {acresPerHour && (
                      <div style={statCard}>
                        <div style={statLabel}>Avg Ac/Hour</div>
                        <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{acresPerHour}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>ac/hr</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>tractor passes only</div>
                      </div>
                    )}
                    <div style={statCard}>
                      <div style={statLabel}>Machines Used</div>
                      <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{uniqueMachines.length}</span></div>
                      <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>unique machines</div>
                    </div>
                    {field.acres && acresPerHour && (
                      <div style={statCard}>
                        <div style={statLabel}>Min/Acre</div>
                        <div><span style={{ fontSize: '22px', color: '#c8d4a0' }}>{Math.round(60 / acresPerHour)}</span><span style={{ fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' }}>min</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>avg per acre</div>
                      </div>
                    )}
                    {downtimeMinutes !== null && downtimeMinutes > 0 && (
                      <div style={{ ...statCard, border: '1px solid #cc880033' }}>
                        <div style={{ ...statLabel, color: '#cc8800' }}>Est. Downtime</div>
                        <div><span style={{ fontSize: '22px', color: '#cc8800' }}>{formatDuration(downtimeMinutes)}</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>turns + seed refills</div>
                        <div style={{ fontSize: '10px', color: '#4a5a3a', marginTop: '2px' }}>planter time − tractor time</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Per Machine Breakdown */}
                <div style={secStyle}>
                  <div style={secTitle}>Time by Machine</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Machine', 'Role', 'Total Time', 'Visits', 'Avg/Visit', 'Ac/Hr'].map(h => (
                          <th key={h} style={{ ...thBase, color: '#4a5a3a' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(machineMap).sort((a, b) => {
                        // Tractors first, then implements
                        if (a.isTractor !== b.isTractor) return a.isTractor ? -1 : 1
                        return b.totalMinutes - a.totalMinutes
                      }).map((m, i) => {
                        const machineAcHr = m.isTractor && field.acres
                          ? Math.round((field.acres / (m.totalMinutes / 60)) * 10) / 10
                          : null
                        return (
                          <tr key={m.name}>
                            <td style={tdStyle(i)}><span style={{ color: '#c8d4a0' }}>{m.name}</span></td>
                            <td style={tdStyle(i)}>
                              <span style={{ fontSize: '11px', color: m.isTractor ? '#a8b888' : '#4a6a8a' }}>
                                {m.isTractor ? m.type : 'Implement'}
                              </span>
                            </td>
                            <td style={tdStyle(i)}><span style={{ color: '#a8c888' }}>{formatDuration(m.totalMinutes)}</span></td>
                            <td style={tdStyle(i)}>{m.visits}</td>
                            <td style={tdStyle(i)}>{formatDuration(Math.round(m.totalMinutes / m.visits))}</td>
                            <td style={tdStyle(i)}>
                              {machineAcHr
                                ? <span style={{ color: '#aad4ff' }}>{machineAcHr}</span>
                                : <span style={{ color: '#3a4a2a', fontSize: '11px' }}>{m.isTractor ? '—' : 'impl'}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Session Log */}
                <div style={{ ...secStyle, borderBottom: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ ...secTitle, marginBottom: 0 }}>Session Log</div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Group by</span>
                      {(['operation', 'date', 'machine'] as const).map(g => (
                        <button key={g} onClick={() => setGroupBy(g)}
                          style={{ padding: '3px 10px', border: `1px solid ${groupBy === g ? '#4a8aaa' : '#2a3020'}`, backgroundColor: groupBy === g ? '#1a2a3a' : 'transparent', color: groupBy === g ? '#aad4ff' : '#6b7a5a', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', textTransform: 'capitalize' }}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  {groupBy === 'operation' && OP_GROUP_ORDER.map(group => {
                    const groupSessions = sessions.filter(s => getOpGroup(s.operation_type) === group)
                    if (groupSessions.length === 0) return null
                    const groupTractorMins = groupSessions.filter(s => s.duration_minutes >= 20 && TRACTOR_TYPES.has(s.machines?.type || '')).reduce((sum, s) => sum + s.duration_minutes, 0)
                    return (
                      <div key={group} style={{ marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', paddingBottom: '6px', borderBottom: `1px solid ${getOpGroupColor(group)}33` }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: getOpGroupColor(group), flexShrink: 0 }} />
                          <span style={{ fontSize: '11px', color: getOpGroupColor(group), letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group}</span>
                          <span style={{ fontSize: '10px', color: '#4a5a3a' }}>{groupSessions.length} sessions — {(groupTractorMins / 60).toFixed(1)} tractor hrs</span>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <SessionTableHeader />
                            <tbody>{renderSessionRows(groupSessions)}</tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}

                  {groupBy === 'date' && (() => {
                    const dates = [...new Set(sessions.map(s => s.date))].sort((a, b) => b.localeCompare(a))
                    return dates.map(date => {
                      const dateSessions = sessions.filter(s => s.date === date)
                      const dateTractorMins = dateSessions.filter(s => s.duration_minutes >= 20 && TRACTOR_TYPES.has(s.machines?.type || '')).reduce((sum, s) => sum + s.duration_minutes, 0)
                      return (
                        <div key={date} style={{ marginBottom: '24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #2a3020' }}>
                            <span style={{ fontSize: '11px', color: '#8a9a6a', letterSpacing: '0.1em' }}>{formatDateShort(date)}</span>
                            <span style={{ fontSize: '10px', color: '#4a5a3a' }}>{dateSessions.length} sessions — {(dateTractorMins / 60).toFixed(1)} tractor hrs</span>
                          </div>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <SessionTableHeader />
                              <tbody>{renderSessionRows(dateSessions)}</tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })
                  })()}

                  {groupBy === 'machine' && (() => {
                    const machineIds = [...new Set(sessions.map(s => s.machine_id))]
                    return machineIds.map(mid => {
                      const machineSessions = sessions.filter(s => s.machine_id === mid)
                      const machineName = machineSessions[0]?.machines?.name || mid
                      const machineType = machineSessions[0]?.machines?.type || null
                      const isTractor = TRACTOR_TYPES.has(machineType || '')
                      const machineWorkMins = machineSessions.filter(s => s.duration_minutes >= 20).reduce((sum, s) => sum + s.duration_minutes, 0)
                      return (
                        <div key={mid} style={{ marginBottom: '24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #2a3020' }}>
                            <span style={{ fontSize: '11px', color: '#a8b888', letterSpacing: '0.1em' }}>{machineName}</span>
                            <span style={{ fontSize: '10px', color: isTractor ? '#4a5a3a' : '#4a6a8a' }}>{isTractor ? machineType : 'Implement'}</span>
                            <span style={{ fontSize: '10px', color: '#4a5a3a' }}>{machineSessions.length} sessions — {(machineWorkMins / 60).toFixed(1)} hrs</span>
                          </div>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <SessionTableHeader />
                              <tbody>{renderSessionRows(machineSessions)}</tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
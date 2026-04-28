'use client'

import { useEffect, useState } from 'react'
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

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
          .limit(100)
      ])
      setYields(yieldData || [])
      setSessions(sessionData || [])
      setLoading(false)
    }
    load()
  }, [field.id])

  const years = [...new Set(yields.map(y => y.year))].sort((a, b) => b - a)
  const cropTypes = [...new Set(yields.map(y => y.crop_type))].sort()

  const cornYields = yields.filter(y => y.crop_type === 'Corn' && y.actual_yield && y.actual_yield > 0)
  const bestCorn = cornYields.length > 0 ? cornYields.reduce((a, b) => (a.actual_yield || 0) > (b.actual_yield || 0) ? a : b) : null
  const currentYearYield = yields.find(y => y.year === new Date().getFullYear())

  // Machine session metrics
  const totalMachineHours = sessions.reduce((sum, s) => sum + s.duration_minutes, 0) / 60
  const uniqueMachines = [...new Set(sessions.map(s => s.machines?.name).filter(Boolean))]
  const acresPerHour = field.acres && totalMachineHours > 0
    ? Math.round((field.acres / totalMachineHours) * 10) / 10
    : null

  // Group sessions by date
  const sessionsByDate: Record<string, MachineSession[]> = {}
  for (const s of sessions) {
    const d = s.date
    if (!sessionsByDate[d]) sessionsByDate[d] = []
    sessionsByDate[d].push(s)
  }

  // Sessions by machine for efficiency summary
  const sessionsByMachine: Record<string, { name: string; type: string | null; totalMinutes: number; visits: number }> = {}
  for (const s of sessions) {
    const mid = s.machine_id
    if (!sessionsByMachine[mid]) {
      sessionsByMachine[mid] = { name: s.machines?.name || mid, type: s.machines?.type || null, totalMinutes: 0, visits: 0 }
    }
    sessionsByMachine[mid].totalMinutes += s.duration_minutes
    sessionsByMachine[mid].visits++
  }

  const s = {
    overlay: {
      position: 'fixed' as const, inset: 0,
      backgroundColor: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1100, padding: '40px 16px', overflowY: 'auto' as const
    },
    panel: {
      backgroundColor: '#0f1410', color: '#e8ead5',
      fontFamily: "'Georgia', serif",
      width: '100%', maxWidth: '960px',
      borderRadius: '8px', border: '1px solid #2a3020',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      overflow: 'hidden'
    },
    header: {
      padding: '24px 28px 20px',
      borderBottom: '1px solid #2a3020',
      backgroundColor: '#0a0f0b',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
    },
    section: {
      padding: '20px 28px',
      borderBottom: '1px solid #1a2016'
    },
    sectionTitle: {
      fontSize: '10px', letterSpacing: '0.2em',
      textTransform: 'uppercase' as const,
      color: '#4a5a3a', marginBottom: '14px'
    },
    statCard: {
      backgroundColor: '#111612', borderRadius: '6px',
      border: '1px solid #2a3020', padding: '14px 16px',
      flex: '1', minWidth: '120px'
    },
    statLabel: { fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' },
    statValue: { fontSize: '22px', color: '#c8d4a0' },
    statUnit: { fontSize: '11px', color: '#6b7a5a', marginLeft: '4px' },
    th: {
      textAlign: 'left' as const, padding: '6px 12px',
      fontSize: '10px', color: '#4a5a3a',
      letterSpacing: '0.1em', textTransform: 'uppercase' as const,
      borderBottom: '1px solid #1a2016'
    },
    td: (i: number) => ({
      padding: '9px 12px', fontSize: '12px',
      borderBottom: '1px solid #1a2016',
      backgroundColor: i % 2 === 0 ? '#111612' : '#0f1410'
    })
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={s.header}>
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
          <button
            onClick={() => setActiveTab('yield')}
            style={{ padding: '12px 24px', border: 'none', cursor: 'pointer', fontSize: '12px', backgroundColor: 'transparent', color: activeTab === 'yield' ? '#c8d4a0' : '#6b7a5a', borderBottom: activeTab === 'yield' ? '2px solid #4aaa4a' : '2px solid transparent' }}>
            Yield & Harvest
          </button>
          <button
            onClick={() => setActiveTab('machines')}
            style={{ padding: '12px 24px', border: 'none', cursor: 'pointer', fontSize: '12px', backgroundColor: 'transparent', color: activeTab === 'machines' ? '#c8d4a0' : '#6b7a5a', borderBottom: activeTab === 'machines' ? '2px solid #4a8aaa' : '2px solid transparent' }}>
            Machine Time {sessions.length > 0 && <span style={{ fontSize: '10px', color: '#4a6a8a', marginLeft: '6px' }}>({sessions.length})</span>}
          </button>
        </div>

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>Loading field data...</div>
        )}

        {/* Yield Tab */}
        {!loading && activeTab === 'yield' && (
          <>
            {yields.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>No yield data available for this field yet.</div>
            ) : (
              <>
                {/* Summary Stats */}
                <div style={s.section}>
                  <div style={s.sectionTitle}>2025 Summary</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {cropTypes.map(crop => {
                      const y = yields.find(y => y.year === 2025 && y.crop_type === crop)
                      if (!y) return null
                      return (
                        <div key={crop} style={s.statCard}>
                          <div style={s.statLabel}>{crop}</div>
                          <div><span style={s.statValue}>{formatYield(y.actual_yield)}</span><span style={s.statUnit}>bu/ac</span></div>
                          <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{formatBu(y.total_bushels)} bu total</div>
                          {y.avg_moisture && <div style={{ fontSize: '11px', color: '#4a8a6a', marginTop: '2px' }}>{y.avg_moisture.toFixed(1)}% moisture</div>}
                        </div>
                      )
                    })}
                    {bestCorn && (
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Best Corn Year</div>
                        <div><span style={s.statValue}>{formatYield(bestCorn.actual_yield)}</span><span style={s.statUnit}>bu/ac</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{bestCorn.year}</div>
                      </div>
                    )}
                    {currentYearYield?.harvest_hours && (
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Harvest Hours</div>
                        <div><span style={s.statValue}>{currentYearYield.harvest_hours.toFixed(1)}</span><span style={s.statUnit}>hrs</span></div>
                        {currentYearYield.total_fuel_gal && <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{(currentYearYield.total_fuel_gal / (currentYearYield.acres_harvested || 1)).toFixed(2)} gal/ac</div>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Yield Bar Chart */}
                <div style={s.section}>
                  <div style={s.sectionTitle}>Yield History by Crop</div>
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

                {/* Detailed Yield Table */}
                <div style={s.section}>
                  <div style={s.sectionTitle}>Harvest Details</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>{['Year', 'Crop', 'Yield (bu/ac)', 'Total Bu', 'Acres', 'Moisture', 'Fuel (gal)', 'Hrs', 'Varieties'].map(h => (<th key={h} style={s.th}>{h}</th>))}</tr>
                      </thead>
                      <tbody>
                        {yields.filter(y => y.actual_yield && y.actual_yield > 0).map((y, i) => (
                          <tr key={y.id}>
                            <td style={s.td(i)}><span style={{ color: '#c8d4a0', fontWeight: 'bold' }}>{y.year}</span></td>
                            <td style={s.td(i)}>{y.crop_type}</td>
                            <td style={s.td(i)}><span style={{ color: '#a8c888' }}>{formatYield(y.actual_yield)}</span></td>
                            <td style={s.td(i)}>{formatBu(y.total_bushels)}</td>
                            <td style={s.td(i)}>{y.acres_harvested?.toFixed(1) || '—'}</td>
                            <td style={s.td(i)}>{y.avg_moisture ? `${y.avg_moisture.toFixed(1)}%` : '—'}</td>
                            <td style={s.td(i)}>{y.total_fuel_gal ? y.total_fuel_gal.toFixed(0) : '—'}</td>
                            <td style={s.td(i)}>{y.harvest_hours ? y.harvest_hours.toFixed(1) : '—'}</td>
                            <td style={{ ...s.td(i), fontSize: '11px', color: '#6b7a5a', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{y.varieties || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Harvest Timing */}
                {yields.some(y => y.first_harvested) && (
                  <div style={{ ...s.section, borderBottom: 'none' }}>
                    <div style={s.sectionTitle}>Harvest Timing</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {yields.filter(y => y.first_harvested).map((y, i) => (
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
              <div style={{ padding: '40px', textAlign: 'center', color: '#6b7a5a' }}>
                No machine session data for this field yet. Run a machine sync to populate.
              </div>
            ) : (
              <>
                {/* Summary Cards */}
                <div style={s.section}>
                  <div style={s.sectionTitle}>Field Efficiency Summary</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={s.statCard}>
                      <div style={s.statLabel}>Total Machine Time</div>
                      <div><span style={s.statValue}>{totalMachineHours.toFixed(1)}</span><span style={s.statUnit}>hrs</span></div>
                      <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>{sessions.length} sessions tracked</div>
                    </div>
                    {acresPerHour && (
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Avg Acres/Hour</div>
                        <div><span style={s.statValue}>{acresPerHour}</span><span style={s.statUnit}>ac/hr</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>all operations</div>
                      </div>
                    )}
                    <div style={s.statCard}>
                      <div style={s.statLabel}>Machines Used</div>
                      <div><span style={s.statValue}>{uniqueMachines.length}</span></div>
                      <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>unique machines</div>
                    </div>
                    {field.acres && acresPerHour && (
                      <div style={s.statCard}>
                        <div style={s.statLabel}>Min/Acre</div>
                        <div><span style={s.statValue}>{Math.round(60 / acresPerHour)}</span><span style={s.statUnit}>min</span></div>
                        <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>avg per acre</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Per Machine Breakdown */}
                <div style={s.section}>
                  <div style={s.sectionTitle}>Time by Machine</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['Machine', 'Type', 'Total Time', 'Visits', 'Avg/Visit', 'Ac/Hr'].map(h => (<th key={h} style={s.th}>{h}</th>))}</tr>
                    </thead>
                    <tbody>
                      {Object.values(sessionsByMachine)
                        .sort((a, b) => b.totalMinutes - a.totalMinutes)
                        .map((m, i) => {
                          const avgPerVisit = Math.round(m.totalMinutes / m.visits)
                          const machineAcHr = field.acres ? Math.round((field.acres / (m.totalMinutes / 60)) * 10) / 10 : null
                          return (
                            <tr key={m.name}>
                              <td style={s.td(i)}><span style={{ color: '#c8d4a0' }}>{m.name}</span></td>
                              <td style={s.td(i)}><span style={{ fontSize: '11px', color: '#6b7a5a' }}>{m.type || '—'}</span></td>
                              <td style={s.td(i)}><span style={{ color: '#a8c888' }}>{formatDuration(m.totalMinutes)}</span></td>
                              <td style={s.td(i)}>{m.visits}</td>
                              <td style={s.td(i)}>{formatDuration(avgPerVisit)}</td>
                              <td style={s.td(i)}>{machineAcHr ? <span style={{ color: '#aad4ff' }}>{machineAcHr}</span> : '—'}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Session Log by Date */}
                <div style={{ ...s.section, borderBottom: 'none' }}>
                  <div style={s.sectionTitle}>Session Log</div>
                  {Object.entries(sessionsByDate)
                    .sort((a, b) => b[0].localeCompare(a[0]))
                    .map(([date, dateSessions]) => (
                      <div key={date} style={{ marginBottom: '20px' }}>
                        <div style={{ fontSize: '11px', color: '#8a9a6a', marginBottom: '8px', letterSpacing: '0.1em' }}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          <span style={{ color: '#4a5a3a', marginLeft: '12px' }}>
                            {formatDuration(dateSessions.reduce((sum, s) => sum + s.duration_minutes, 0))} total
                          </span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>{['Machine', 'Entered', 'Exited', 'Duration', 'Ac/Hr'].map(h => (<th key={h} style={{ ...s.th, fontSize: '9px' }}>{h}</th>))}</tr>
                          </thead>
                          <tbody>
                            {dateSessions
                              .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())
                              .map((session, i) => {
                                const acHr = field.acres ? Math.round((field.acres / (session.duration_minutes / 60)) * 10) / 10 : null
                                const isLongSession = session.duration_minutes > 20
                                return (
                                  <tr key={session.id}>
                                    <td style={s.td(i)}><span style={{ color: '#a8b888', fontSize: '12px' }}>{session.machines?.name || session.machine_id}</span></td>
                                    <td style={s.td(i)}><span style={{ color: '#6b7a5a', fontSize: '11px' }}>{formatTime(session.entered_at)}</span></td>
                                    <td style={s.td(i)}><span style={{ color: '#6b7a5a', fontSize: '11px' }}>{formatTime(session.exited_at)}</span></td>
                                    <td style={s.td(i)}>
                                      <span style={{ color: isLongSession ? '#c8d4a0' : '#4a5a3a', fontSize: '12px' }}>
                                        {formatDuration(session.duration_minutes)}
                                      </span>
                                    </td>
                                    <td style={s.td(i)}>
                                      {acHr && isLongSession
                                        ? <span style={{ color: '#aad4ff', fontSize: '12px' }}>{acHr}</span>
                                        : <span style={{ color: '#4a5a3a', fontSize: '11px' }}>—</span>}
                                    </td>
                                  </tr>
                                )
                              })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
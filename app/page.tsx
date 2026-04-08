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

type Field = { id: string; name: string; acres: number | null; region: string | null; boundary: object | null }
type OperationType = { id: string; name: string; color: string }
type Operation = {
  id: string
  date: string
  field_id: string
  operation_type_id: string
  notes: string
  fields: { name: string }
  operation_types: { name: string; color: string }
}

type SelectedOp = {
  op: Operation
  fieldName: string
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
  const [opTypes, setOpTypes] = useState<OperationType[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'calendar' | 'year' | 'map'>('calendar')
  const [showModal, setShowModal] = useState(false)
  const [editOp, setEditOp] = useState<Operation | null>(null)
  const [selectedOp, setSelectedOp] = useState<SelectedOp | null>(null)
  const [deleting, setDeleting] = useState(false)

  const today = now.getDate()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const daysInMonth = getDaysInMonth(year, month)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  async function loadData() {
    setLoading(true)
    try {
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
      const [fieldsData, opTypesData] = await Promise.all([
        getFields(),
        getOperationTypes()
      ])

      const { data: opsData } = await supabaseClient
        .from('operations')
        .select('*, fields(name), operation_types(name, color)')
        .gte('date', startDate)
        .lte('date', endDate)

      setFields(fieldsData || [])
      setOperations(opsData || [])
      setOpTypes(opTypesData || [])
    } catch (err) {
      console.error('Error loading data:', err)
    }
    setLoading(false)
  }

  async function loadYearData() {
    setLoading(true)
    try {
      const [fieldsData, opTypesData] = await Promise.all([
        getFields(),
        getOperationTypes()
      ])

      const { data: opsData } = await supabaseClient
        .from('operations')
        .select('*, fields(name), operation_types(name, color)')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)

      setFields(fieldsData || [])
      setAllYearOps(opsData || [])
      setOpTypes(opTypesData || [])
    } catch (err) {
      console.error('Error loading year data:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (view === 'year') {
      loadYearData()
    } else {
      loadData()
    }
  }, [year, month, view])

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

  const fieldsWithHeat = fields.map(f => {
    const fieldOps = operations.filter(op => op.field_id === f.id)
    const latest = fieldOps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    return { ...f, daysSinceWork: latest ? daysSince(latest.date) : undefined }
  })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1410', color: '#e8ead5', fontFamily: "'Georgia', serif" }}
      onClick={() => setSelectedOp(null)}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a3020', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#6b7a5a', textTransform: 'uppercase', marginBottom: '4px' }}>Field Operations Manager</div>
          <h1 style={{ fontSize: '24px', fontWeight: 'normal', margin: 0, color: '#c8d4a0' }}>Activity Calendar</h1>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {opTypes.map(op => (
              <div key={op.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8a9a6a' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: op.color }} />
                {op.name}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', border: '1px solid #2a3020', borderRadius: '4px', overflow: 'hidden' }}>
            <button onClick={() => setView('calendar')} style={{
              padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none',
              backgroundColor: view === 'calendar' ? '#2a3020' : 'transparent',
              color: view === 'calendar' ? '#c8d4a0' : '#6b7a5a'
            }}>Month</button>
            <button onClick={() => setView('year')} style={{
              padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none',
              backgroundColor: view === 'year' ? '#2a3020' : 'transparent',
              color: view === 'year' ? '#c8d4a0' : '#6b7a5a'
            }}>Year</button>
            <button onClick={() => setView('map')} style={{
              padding: '6px 14px', cursor: 'pointer', fontSize: '12px', border: 'none',
              backgroundColor: view === 'map' ? '#2a3020' : 'transparent',
              color: view === 'map' ? '#c8d4a0' : '#6b7a5a'
            }}>Heat Map</button>
          </div>
          <button onClick={() => setShowModal(true)} style={{
            padding: '6px 16px', backgroundColor: '#2d6a2d', border: 'none',
            color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
          }}>+ Log Operation</button>
          <button onClick={handleSignOut} style={{
            padding: '6px 14px', background: 'none', border: '1px solid #2a3020',
            color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
          }}>Sign Out</button>
        </div>
      </div>

      {/* JD Connect Banner */}
      <div style={{ padding: '10px 32px', backgroundColor: '#0a1208', borderBottom: '1px solid #2a3020', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', color: '#6b7a5a' }}>John Deere Operations Center</span>
        <a href="/api/auth/jd" style={{
          padding: '5px 14px', backgroundColor: '#367c2b', color: '#fff',
          borderRadius: '4px', fontSize: '12px', textDecoration: 'none'
        }}>Connect John Deere</a>
      </div>

      {/* Year / Month Nav */}
      <div style={{ padding: '16px 32px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        {view === 'year' ? (
          <>
            <button onClick={() => setYear(y => y - 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>‹</button>
            <span style={{ fontSize: '18px', color: '#c8d4a0', minWidth: '100px', textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => y + 1)} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>›</button>
          </>
        ) : (
          <>
            <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>‹</button>
            <span style={{ fontSize: '18px', color: '#c8d4a0', minWidth: '200px', textAlign: 'center' }}>{monthName}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>›</button>
          </>
        )}
      </div>

      {loading && <div style={{ padding: '40px 32px', color: '#6b7a5a', fontSize: '14px' }}>Loading field data...</div>}

      {/* Year View */}
      {!loading && view === 'year' && fields.length > 0 && (
        <div style={{ padding: '0 32px 32px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ width: '180px', padding: '8px 12px', textAlign: 'left', fontSize: '11px', letterSpacing: '0.15em', color: '#6b7a5a', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0f1410' }}>
                  Field
                </th>
                {MONTHS.map((m, i) => (
                  <th key={m} style={{
                    padding: '8px 4px', textAlign: 'center', fontSize: '11px',
                    color: i === currentMonth && year === currentYear ? '#c8d4a0' : '#6b7a5a',
                    borderBottom: '1px solid #2a3020',
                    borderLeft: i === currentMonth && year === currentYear ? '2px solid #c8d4a040' : undefined,
                    fontWeight: i === currentMonth && year === currentYear ? 'bold' : 'normal'
                  }}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {['North', 'South'].map(region => (
                <React.Fragment key={region}>
                  <tr>
                    <td colSpan={13} style={{
                      padding: '6px 12px', fontSize: '10px', letterSpacing: '0.15em',
                      textTransform: 'uppercase', color: '#4a5a3a',
                      backgroundColor: '#0a0f0b', borderBottom: '1px solid #2a3020'
                    }}>
                      {region}ern Operation
                    </td>
                  </tr>
                  {fields.filter(f => f.region === region).map((field, fi) => (
                    <tr key={field.id} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                      <td style={{
                        padding: '6px 12px', fontSize: '12px', color: '#a8b888',
                        borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap',
                        position: 'sticky', left: 0, backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410'
                      }}>
                        {field.name}
                        {field.acres && <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '6px' }}>{field.acres}ac</span>}
                      </td>
                      {MONTHS.map((m, mi) => {
                        const monthOps = getOpsForMonth(field.id, mi)
                        const isCurrentMonth = mi === currentMonth && year === currentYear
                        return (
                          <td key={m} style={{
                            padding: '4px 2px', textAlign: 'center',
                            borderBottom: '1px solid #1a2016',
                            borderLeft: isCurrentMonth ? '2px solid #c8d4a020' : undefined,
                            minWidth: '48px'
                          }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'center' }}>
                              {monthOps.map(op => (
                                <div
                                  key={op.id}
                                  onClick={e => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                  title={`${op.operation_types?.name} — ${new Date(op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                  style={{
                                    width: '10px', height: '10px', borderRadius: '2px',
                                    backgroundColor: op.operation_types?.color || '#666',
                                    cursor: 'pointer', flexShrink: 0
                                  }}
                                />
                              ))}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Map View */}
      {!loading && view === 'map' && (
        <div style={{ padding: '0 32px 32px' }}>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            {[
              { label: 'Today', color: '#ff2200' },
              { label: 'This week', color: '#ff6600' },
              { label: '2 weeks', color: '#ffaa00' },
              { label: '1 month', color: '#88cc00' },
              { label: '2 months', color: '#226622' },
              { label: 'Not worked', color: '#2a3020' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8a9a6a' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
          <FieldMap fields={fieldsWithHeat} />
        </div>
      )}

      {/* Month Calendar View */}
      {!loading && view === 'calendar' && fields.length > 0 && (
        <div style={{ padding: '0 32px 32px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${daysInMonth * 36 + 160}px` }}>
            <thead>
              <tr>
                <th style={{ width: '150px', padding: '8px 12px', textAlign: 'left', fontSize: '11px', letterSpacing: '0.15em', color: '#6b7a5a', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0f1410' }}>
                  Field
                </th>
                {days.map(day => {
                  const weekday = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)
                  const isToday = day === today && month === currentMonth && year === currentYear
                  const weekend = isWeekend(year, month, day)
                  return (
                    <th key={day} style={{
                      width: '36px', padding: '4px 2px', textAlign: 'center',
                      fontSize: '10px', color: weekend ? '#4a5a3a' : '#6b7a5a',
                      borderBottom: '1px solid #2a3020',
                      borderLeft: isToday ? '2px solid #c8d4a0' : undefined,
                      backgroundColor: isToday ? '#1a2016' : undefined,
                    }}>
                      <div>{weekday}</div>
                      <div style={{ fontSize: '11px', color: isToday ? '#c8d4a0' : undefined, fontWeight: isToday ? 'bold' : 'normal' }}>{day}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {['North', 'South'].map(region => (
                <React.Fragment key={region}>
                  <tr>
                    <td colSpan={daysInMonth + 1} style={{
                      padding: '6px 12px', fontSize: '10px', letterSpacing: '0.15em',
                      textTransform: 'uppercase', color: '#4a5a3a',
                      backgroundColor: '#0a0f0b', borderBottom: '1px solid #2a3020'
                    }}>
                      {region}ern Operation
                    </td>
                  </tr>
                  {fields.filter(f => f.region === region).map((field, fi) => (
                    <tr key={field.id} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                      <td style={{
                        padding: '6px 12px', fontSize: '13px', color: '#a8b888',
                        borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap',
                        position: 'sticky', left: 0, backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410'
                      }}>
                        {field.name}
                        {field.acres && <span style={{ fontSize: '10px', color: '#4a5a3a', marginLeft: '6px' }}>{field.acres}ac</span>}
                      </td>
                      {days.map(day => {
                        const op = getOperation(field.id, day)
                        const isToday = day === today && month === currentMonth && year === currentYear
                        const weekend = isWeekend(year, month, day)
                        return (
                          <td key={day} style={{
                            padding: '3px 2px', textAlign: 'center',
                            borderBottom: '1px solid #1a2016',
                            borderLeft: isToday ? '2px solid #c8d4a04a' : undefined,
                            backgroundColor: weekend ? '#0d1009' : undefined,
                          }}>
                            {op && (
                              <div
                                onClick={(e) => { e.stopPropagation(); setSelectedOp({ op, fieldName: field.name }) }}
                                title={op.operation_types?.name}
                                style={{
                                  backgroundColor: op.operation_types?.color || '#666',
                                  color: '#fff',
                                  width: '28px', height: '22px', borderRadius: '3px',
                                  margin: '0 auto', fontSize: '8px', display: 'flex',
                                  alignItems: 'center', justifyContent: 'center',
                                  letterSpacing: '0.05em', cursor: 'pointer'
                                }}>
                                {op.operation_types?.name?.replace('Tillage - ', '').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Operation Popup */}
      {selectedOp && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#111612', border: '1px solid #2a3020',
            borderRadius: '6px', padding: '12px 16px', zIndex: 999,
            minWidth: '200px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
          }}>
          <div style={{ fontSize: '13px', color: '#c8d4a0', marginBottom: '4px', fontWeight: 'bold' }}>
            {selectedOp.fieldName}
          </div>
          <div style={{ fontSize: '12px', color: '#8a9a6a', marginBottom: '2px' }}>
            {selectedOp.op.operation_types?.name}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7a5a', marginBottom: '12px' }}>
            {new Date(selectedOp.op.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {selectedOp.op.notes && (
            <div style={{ fontSize: '12px', color: '#6b7a5a', marginBottom: '12px', fontStyle: 'italic' }}>
              {selectedOp.op.notes}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setEditOp(selectedOp.op); setSelectedOp(null) }} style={{
              padding: '5px 12px', backgroundColor: '#1a2a3a', border: 'none',
              color: '#aac8ff', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
            }}>Edit</button>
            <button onClick={handleDelete} disabled={deleting} style={{
              padding: '5px 12px', backgroundColor: '#6b1a1a', border: 'none',
              color: '#ffaaaa', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
            }}>{deleting ? 'Deleting...' : 'Delete'}</button>
            <button onClick={() => setSelectedOp(null)} style={{
              padding: '5px 12px', background: 'none', border: '1px solid #2a3020',
              color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Operation Modal */}
      {showModal && (
        <AddOperationModal
          fields={fields}
          opTypes={opTypes}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); view === 'year' ? loadYearData() : loadData() }}
        />
      )}

      {/* Edit Operation Modal */}
      {editOp && (
        <AddOperationModal
          fields={fields}
          opTypes={opTypes}
          onClose={() => setEditOp(null)}
          onSaved={() => { setEditOp(null); view === 'year' ? loadYearData() : loadData() }}
          editOperation={{
            id: editOp.id,
            field_id: editOp.field_id,
            operation_type_id: editOp.operation_type_id,
            date: editOp.date,
            notes: editOp.notes || ''
          }}
        />
      )}
    </div>
  )
}
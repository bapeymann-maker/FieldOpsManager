'use client'

import { useState } from 'react'

const OPERATION_TYPES = [
  { name: 'Tillage',     color: '#a0522d', bg: '#a0522d20' },
  { name: 'Planting',    color: '#2d6a2d', bg: '#2d6a2d20' },
  { name: 'Spraying',    color: '#1a3a6e', bg: '#1a3a6e20' },
  { name: 'Harvesting',  color: '#b8860b', bg: '#b8860b20' },
  { name: 'Fertilizing', color: '#c45c00', bg: '#c45c0020' },
]

// Mock data - will be replaced with Supabase data later
const MOCK_FIELDS = [
  'North 80', 'South Quarter', 'River Bottoms', 'East Hillside',
  'Home Place', 'Gravel Pit', 'County Road', 'Back Forty',
]

const MOCK_OPERATIONS: Record<string, { type: string; date: string }[]> = {
  'North 80':      [{ type: 'Tillage', date: '2026-04-01' }, { type: 'Planting', date: '2025-04-15' }],
  'South Quarter': [{ type: 'Planting', date: '2026-04-10' }, { type: 'Spraying', date: '2025-04-22' }],
  'River Bottoms': [{ type: 'Fertilizing', date: '2026-04-05' }, { type: 'Planting', date: '2025-04-18' }],
  'East Hillside': [{ type: 'Tillage', date: '2026-04-03' }],
  'Home Place':    [{ type: 'Harvesting', date: '2026-04-28' }],
  'Gravel Pit':    [{ type: 'Spraying', date: '2026-04-12' }, { type: 'Fertilizing', date: '2025-04-20' }],
  'County Road':   [{ type: 'Planting', date: '2026-04-14' }],
  'Back Forty':    [{ type: 'Tillage', date: '2026-04-02' }, { type: 'Planting', date: '2025-04-16' }, { type: 'Spraying', date: '2025-04-25' }],
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getDayLabel(year: number, month: number, day: number) {
  const date = new Date(year, month, day)
  return { day, weekday: date.toLocaleDateString('en-US', { weekday: 'short' }) }
}

function isWeekend(year: number, month: number, day: number) {
  const d = new Date(year, month, day).getDay()
  return d === 0 || d === 6
}

export default function Home() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const today = now.getDate()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const daysInMonth = getDaysInMonth(year, month)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function getOperation(field: string, day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const ops = MOCK_OPERATIONS[field] || []
    return ops.find(op => op.date === dateStr) || null
  }

  function getOpStyle(type: string) {
    const op = OPERATION_TYPES.find(o => o.name === type)
    return op ? { backgroundColor: op.color, color: '#fff' } : {}
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1410', color: '#e8ead5', fontFamily: "'Georgia', serif" }}>
      
      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a3020', padding: '24px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#6b7a5a', textTransform: 'uppercase', marginBottom: '4px' }}>Field Operations Manager</div>
          <h1 style={{ fontSize: '28px', fontWeight: 'normal', margin: 0, color: '#c8d4a0' }}>Activity Calendar</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {OPERATION_TYPES.map(op => (
            <div key={op.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8a9a6a' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: op.color }} />
              {op.name}
            </div>
          ))}
        </div>
      </div>

      {/* Month Nav */}
      <div style={{ padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>‹</button>
        <span style={{ fontSize: '18px', color: '#c8d4a0', minWidth: '200px', textAlign: 'center' }}>{monthName}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #2a3020', color: '#8a9a6a', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}>›</button>
      </div>

      {/* Table */}
      <div style={{ padding: '0 32px 32px', overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${daysInMonth * 36 + 160}px` }}>
          <thead>
            <tr>
              <th style={{ width: '150px', padding: '8px 12px', textAlign: 'left', fontSize: '11px', letterSpacing: '0.15em', color: '#6b7a5a', textTransform: 'uppercase', borderBottom: '1px solid #2a3020', position: 'sticky', left: 0, backgroundColor: '#0f1410' }}>
                Field
              </th>
              {days.map(day => {
                const { weekday } = getDayLabel(year, month, day)
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
                    <div>{weekday.charAt(0)}</div>
                    <div style={{ fontSize: '11px', color: isToday ? '#c8d4a0' : undefined, fontWeight: isToday ? 'bold' : 'normal' }}>{day}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {MOCK_FIELDS.map((field, fi) => (
              <tr key={field} style={{ backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410' }}>
                <td style={{
                  padding: '6px 12px', fontSize: '13px', color: '#a8b888',
                  borderBottom: '1px solid #1a2016', whiteSpace: 'nowrap',
                  position: 'sticky', left: 0, backgroundColor: fi % 2 === 0 ? '#111612' : '#0f1410'
                }}>
                  {field}
                </td>
                {days.map(day => {
                  const op = getOperation(field, day)
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
                        <div title={op.type} style={{
                          ...getOpStyle(op.type),
                          width: '28px', height: '22px', borderRadius: '3px',
                          margin: '0 auto', fontSize: '8px', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          letterSpacing: '0.05em', cursor: 'default'
                        }}>
                          {op.type.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
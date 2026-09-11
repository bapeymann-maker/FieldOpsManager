'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  type OrchestratorField,
  type Resource,
  type ResourcePairing,
  type Task,
  type TaskType,
  buildDailyReportText,
} from '@/lib/orchestrator'
import { fetchTasks } from '@/lib/orchestrator-data'
import { C } from './ui'

type Props = {
  dateStr: string
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  pairings: ResourcePairing[]
  onClose: () => void
  onDateChange: (dateStr: string) => void
}

export default function DailyReportModal({
  dateStr,
  taskTypes,
  fields,
  resources,
  pairings,
  onClose,
  onDateChange,
}: Props) {
  const [copied, setCopied] = useState(false)
  // The report can point at any date, not just whatever the main page has
  // currently loaded, so it fetches that day's tasks itself. `loading` is
  // derived (loaded.forDate !== dateStr) rather than a separate flag set
  // synchronously in the effect, so there's no direct setState at the top
  // of the effect body — only inside the fetch's own callbacks.
  const [loaded, setLoaded] = useState<{ forDate: string; tasks: Task[] } | null>(null)
  const [error, setError] = useState('')
  const loading = loaded?.forDate !== dateStr

  useEffect(() => {
    let cancelled = false
    fetchTasks([dateStr])
      .then((t) => {
        if (!cancelled) setLoaded({ forDate: dateStr, tasks: t })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tasks.')
      })
    return () => {
      cancelled = true
    }
  }, [dateStr])

  const tasks = useMemo(() => (loaded?.forDate === dateStr ? loaded.tasks : []), [loaded, dateStr])

  const text = useMemo(
    () => buildDailyReportText(dateStr, tasks, taskTypes, fields, resources, pairings),
    [dateStr, tasks, taskTypes, fields, resources, pairings],
  )

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      alert('Could not copy automatically — select the text below and copy it manually.')
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '28px',
          width: '600px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: C.serif,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'normal', color: C.heading }}>Daily Report</h2>
        </div>
        <div style={{ fontSize: '11px', color: C.muted, marginBottom: '16px' }}>
          Equipment/operator lines follow default pairings set in the Resource Pool.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', color: C.text }}>
          <span style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.muted }}>Date</span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => onDateChange(e.target.value)}
            style={{
              padding: '6px 10px',
              backgroundColor: C.bg,
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: '4px',
              fontSize: '13px',
              fontFamily: C.serif,
            }}
          />
        </label>

        {error && <div style={{ color: '#ff6b6b', fontSize: '12px', marginBottom: '10px' }}>{error}</div>}

        <textarea
          readOnly
          value={loading ? 'Loading…' : text}
          style={{
            flex: 1,
            minHeight: '320px',
            padding: '12px',
            backgroundColor: C.bg,
            border: `1px solid ${C.border}`,
            color: C.text,
            borderRadius: '4px',
            fontSize: '13px',
            fontFamily: 'ui-monospace, Consolas, monospace',
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
            marginBottom: '16px',
          }}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onClose} style={ghostBtn}>
            Close
          </button>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {copied && <span style={{ fontSize: '12px', color: C.greenText }}>Copied!</span>}
            <button onClick={() => window.print()} style={ghostBtn}>
              Print
            </button>
            <button onClick={handleCopy} disabled={loading} style={primaryBtn}>
              Copy for crew
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px',
  backgroundColor: C.green,
  border: 'none',
  color: '#fff',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

const ghostBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: 'none',
  border: `1px solid ${C.border}`,
  color: C.muted,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

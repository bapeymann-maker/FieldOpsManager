'use client'

import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Field = { id: string; name: string; region: string | null }
type OperationType = { id: string; name: string; color: string }

type Props = {
  fields: Field[]
  opTypes: OperationType[]
  onClose: () => void
  onSaved: () => void
}

export default function AddOperationModal({ fields, opTypes, onClose, onSaved }: Props) {
  const [fieldId, setFieldId] = useState('')
  const [opTypeId, setOpTypeId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const northFields = fields.filter(f => f.region === 'North')
  const southFields = fields.filter(f => f.region === 'South')

  async function handleSave() {
    if (!fieldId || !opTypeId || !date) {
      setError('Please fill in all required fields')
      return
    }
    setSaving(true)
    setError('')
    const { error } = await supabase.from('operations').insert({
      field_id: fieldId,
      operation_type_id: opTypeId,
      date,
      notes,
      source: 'manual'
    })
    if (error) {
      setError(error.message)
      setSaving(false)
    } else {
      onSaved()
      onClose()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#111612', border: '1px solid #2a3020',
        borderRadius: '8px', padding: '32px', width: '480px', maxWidth: '90vw'
      }}>
        <h2 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 'normal', color: '#c8d4a0', fontFamily: 'Georgia, serif' }}>
          Log Field Operation
        </h2>

        {/* Field Select */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Field *
          </label>
          <select value={fieldId} onChange={e => setFieldId(e.target.value)} style={{
            width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
            border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
            fontSize: '14px', fontFamily: 'Georgia, serif'
          }}>
            <option value="">Select a field...</option>
            <optgroup label="Northern Operation">
              {northFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </optgroup>
            <optgroup label="Southern Operation">
              {southFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </optgroup>
          </select>
        </div>

        {/* Operation Type */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Operation Type *
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {opTypes.map(op => (
              <button key={op.id} onClick={() => setOpTypeId(op.id)} style={{
                padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                border: opTypeId === op.id ? `2px solid ${op.color}` : '2px solid #2a3020',
                backgroundColor: opTypeId === op.id ? op.color + '33' : 'transparent',
                color: opTypeId === op.id ? op.color : '#6b7a5a'
              }}>
                {op.name}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Date *
          </label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
            width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
            border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
            fontSize: '14px', boxSizing: 'border-box'
          }} />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Notes
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{
            width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
            border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
            fontSize: '14px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Georgia, serif'
          }} placeholder="Optional notes..." />
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'none', border: '1px solid #2a3020',
            color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '14px'
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 20px', backgroundColor: '#2d6a2d', border: 'none',
            color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '14px'
          }}>
            {saving ? 'Saving...' : 'Log Operation'}
          </button>
        </div>
      </div>
    </div>
  )
}
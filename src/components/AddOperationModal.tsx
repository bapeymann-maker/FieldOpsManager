'use client'

import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Field = { id: string; name: string; region: string | null; cert_status: string | null }
type OperationType = { id: string; name: string; color: string }

type Props = {
  fields: Field[]
  opTypes: OperationType[]
  onClose: () => void
  onSaved: () => void
  editOperation?: {
    id: string
    field_id: string
    operation_type_id: string
    date: string
    notes: string
  }
}

export default function AddOperationModal({ fields, opTypes, onClose, onSaved, editOperation }: Props) {
  const [fieldId, setFieldId] = useState(editOperation?.field_id || '')
  const [opTypeId, setOpTypeId] = useState(editOperation?.operation_type_id || '')
  const [date, setDate] = useState(editOperation?.date || new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState(editOperation?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showChemWarning, setShowChemWarning] = useState(false)

  const isEditing = !!editOperation

  const tillageTypes = opTypes.filter(op => op.name.startsWith('Tillage'))
  const otherTypes = opTypes.filter(op => !op.name.startsWith('Tillage'))

  const northFields = fields.filter(f => f.region === 'North')
  const southFields = fields.filter(f => f.region === 'South')

  const selectedField = fields.find(f => f.id === fieldId)
  const selectedOpType = opTypes.find(op => op.id === opTypeId)
  const isChemical = selectedOpType?.name === 'Application - Chemical'
  const isCertOrTransition = selectedField?.cert_status === 'Certified' ||
    selectedField?.cert_status === 'Transition 1' ||
    selectedField?.cert_status === 'Transition 2'

  function handleOpTypeSelect(id: string) {
    setOpTypeId(id)
    setShowChemWarning(false)
  }

  function handleFieldSelect(id: string) {
    setFieldId(id)
    setShowChemWarning(false)
  }

  async function handleSave() {
    if (!fieldId || !opTypeId || !date) {
      setError('Please fill in all required fields')
      return
    }

    // Show warning if chemical on certified/transition field
    if (isChemical && isCertOrTransition && !showChemWarning) {
      setShowChemWarning(true)
      return
    }

    setSaving(true)
    setError('')

    if (isEditing) {
      const { error } = await supabase.from('operations').update({
        field_id: fieldId,
        operation_type_id: opTypeId,
        date,
        notes
      }).eq('id', editOperation.id)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('operations').insert({
        field_id: fieldId,
        operation_type_id: opTypeId,
        date,
        notes,
        source: 'manual'
      })
      if (error) { setError(error.message); setSaving(false); return }
    }

    onSaved()
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#111612', border: '1px solid #2a3020',
        borderRadius: '8px', padding: '32px', width: '520px', maxWidth: '90vw',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <h2 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 'normal', color: '#c8d4a0', fontFamily: 'Georgia, serif' }}>
          {isEditing ? 'Edit Operation' : 'Log Field Operation'}
        </h2>

        {/* Chemical Warning */}
        {showChemWarning && (
          <div style={{
            backgroundColor: '#3a1a00', border: '1px solid #aa4400',
            borderRadius: '6px', padding: '16px', marginBottom: '20px'
          }}>
            <div style={{ fontSize: '14px', color: '#ffaa44', fontWeight: 'bold', marginBottom: '8px' }}>
              ⚠ Organic Certification Warning
            </div>
            <div style={{ fontSize: '13px', color: '#cc8833', marginBottom: '12px' }}>
              <strong>{selectedField?.name}</strong> is <strong>{selectedField?.cert_status}</strong>.
              Applying a chemical to this field may jeopardize its organic certification status.
              Are you sure you want to proceed?
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setShowChemWarning(false); setSaving(true); handleSave() }} style={{
                padding: '7px 16px', backgroundColor: '#aa4400', border: 'none',
                color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
              }}>Yes, log anyway</button>
              <button onClick={() => setShowChemWarning(false)} style={{
                padding: '7px 16px', background: 'none', border: '1px solid #2a3020',
                color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
              }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Field Select */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Field *
          </label>
          <select value={fieldId} onChange={e => handleFieldSelect(e.target.value)} style={{
            width: '100%', padding: '8px 12px', backgroundColor: '#0f1410',
            border: '1px solid #2a3020', color: '#e8ead5', borderRadius: '4px',
            fontSize: '14px', fontFamily: 'Georgia, serif'
          }}>
            <option value="">Select a field...</option>
            <optgroup label="Northern Operation">
              {northFields.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.cert_status === 'Certified' ? 'O' : f.cert_status === 'Transition 2' ? 'T2' : f.cert_status === 'Transition 1' ? 'T1' : 'CONV'})
                </option>
              ))}
            </optgroup>
            <optgroup label="Southern Operation">
              {southFields.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.cert_status === 'Certified' ? 'O' : f.cert_status === 'Transition 2' ? 'T2' : f.cert_status === 'Transition 1' ? 'T1' : 'CONV'})
                </option>
              ))}
            </optgroup>
          </select>
          {selectedField && (
            <div style={{ fontSize: '11px', color: '#6b7a5a', marginTop: '4px' }}>
              Status: <span style={{ color: selectedField.cert_status === 'Certified' ? '#4aaa4a' : selectedField.cert_status?.startsWith('Transition') ? '#aaaa00' : '#6b7a5a' }}>
                {selectedField.cert_status || 'Conventional'}
              </span>
            </div>
          )}
        </div>

        {/* Operation Type */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#6b7a5a', marginBottom: '8px' }}>
            Operation Type *
          </label>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>Tillage</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {tillageTypes.map(op => (
                <button key={op.id} onClick={() => handleOpTypeSelect(op.id)} style={{
                  padding: '5px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                  border: opTypeId === op.id ? `2px solid ${op.color}` : '2px solid #2a3020',
                  backgroundColor: opTypeId === op.id ? op.color + '33' : 'transparent',
                  color: opTypeId === op.id ? op.color : '#6b7a5a'
                }}>
                  {op.name.replace('Tillage - ', '')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#4a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>Other</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {otherTypes.map(op => (
                <button key={op.id} onClick={() => handleOpTypeSelect(op.id)} style={{
                  padding: '5px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                  border: opTypeId === op.id ? `2px solid ${op.color}` : '2px solid #2a3020',
                  backgroundColor: opTypeId === op.id ? op.color + '33' : 'transparent',
                  color: opTypeId === op.id ? op.color : '#6b7a5a'
                }}>
                  {op.name}
                </button>
              ))}
            </div>
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

        {!showChemWarning && (
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{
              padding: '8px 20px', background: 'none', border: '1px solid #2a3020',
              color: '#6b7a5a', borderRadius: '4px', cursor: 'pointer', fontSize: '14px'
            }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '8px 20px', backgroundColor: '#2d6a2d', border: 'none',
              color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '14px'
            }}>
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Log Operation'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
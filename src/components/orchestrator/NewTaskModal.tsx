'use client'

import React, { useMemo, useState } from 'react'
import {
  BIN_SITES,
  ELEVATORS,
  FIELD_SECTIONS,
  HAUL_COMMODITIES,
  type DefaultGroup,
  type FieldSection,
  type HaulCommodity,
  type HaulDetails,
  type HaulLocation,
  type NewTaskInput,
  type OrchestratorField,
  type Resource,
  type ResourcePairing,
  type ResourceStatus,
  type Task,
  type TaskType,
  equipmentCategoriesForTaskType,
  fieldsInSection,
  formatHour,
  formatShiftWindow,
  formatAvailableDays,
  groupAssetsByCategory,
  groupEmployeesByDivision,
  isDayAvailable,
  isSameLocalDay,
  pairedWith,
  resourceStatusNow,
} from '@/lib/orchestrator'
import { C, STATUS_COLOR } from './ui'

type Props = {
  dateStr: string
  now: Date
  taskTypes: TaskType[]
  fields: OrchestratorField[]
  resources: Resource[]
  defaultGroups: DefaultGroup[]
  pairings: ResourcePairing[]
  tasksForDate: Task[]
  onClose: () => void
  onCreate: (input: NewTaskInput, resourceIds: string[]) => Promise<void>
  onAddField: (name: string, section: FieldSection) => Promise<OrchestratorField>
  onAddResource: (input: {
    name: string
    type: 'asset' | 'employee'
    shift_start: number | null
    shift_end: number | null
    category?: string | null
  }) => Promise<Resource>
}

const HOUR_OPTIONS = Array.from({ length: 49 }, (_, i) => i / 2) // 0, 0.5 ... 24

type OriginKind = 'field' | 'bin'
type DestKind = 'home_wet_bin' | 'lb_pork' | 'bin' | 'elevator' | 'other'

type Screen =
  | 'type'
  | 'section'
  | 'field'
  | 'haul-commodity'
  | 'haul-origin-choice'
  | 'haul-origin-bin-site'
  | 'haul-origin-bin-number'
  | 'haul-dest-choice'
  | 'haul-dest-bin-site'
  | 'haul-dest-bin-number'
  | 'haul-dest-elevator'
  | 'haul-dest-other'
  | 'equipment'
  | 'employees'
  | 'details'

const SCREEN_LABELS: Record<Screen, string> = {
  type: 'Task type',
  section: 'Section',
  field: 'Field',
  'haul-commodity': 'Commodity',
  'haul-origin-choice': 'Origin',
  'haul-origin-bin-site': 'Origin bin',
  'haul-origin-bin-number': 'Origin bin #',
  'haul-dest-choice': 'Destination',
  'haul-dest-bin-site': 'Destination bin',
  'haul-dest-bin-number': 'Destination bin #',
  'haul-dest-elevator': 'Elevator',
  'haul-dest-other': 'Destination',
  equipment: 'Equipment',
  employees: 'Crew',
  details: 'Details',
}

export default function NewTaskModal({
  dateStr,
  now,
  taskTypes,
  fields,
  resources,
  defaultGroups,
  pairings,
  tasksForDate,
  onClose,
  onCreate,
  onAddField,
  onAddResource,
}: Props) {
  const [screen, setScreen] = useState<Screen>('type')
  const [history, setHistory] = useState<Screen[]>([])

  const [typeId, setTypeId] = useState('')
  const [section, setSection] = useState<FieldSection | ''>('')
  const [fieldId, setFieldId] = useState('')
  const [pickedResources, setPickedResources] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [taskDate, setTaskDate] = useState(dateStr)
  const [allDay, setAllDay] = useState(false)
  const [startHour, setStartHour] = useState(8)
  const [endHour, setEndHour] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [newFieldName, setNewFieldName] = useState('')
  const [newResName, setNewResName] = useState('')
  const [newAssetCategory, setNewAssetCategory] = useState('')

  // Hauling-only state
  const [commodity, setCommodity] = useState<HaulCommodity | ''>('')
  const [originKind, setOriginKind] = useState<OriginKind | ''>('')
  const [originBinSite, setOriginBinSite] = useState('')
  const [originBinNumber, setOriginBinNumber] = useState('')
  const [destKind, setDestKind] = useState<DestKind | ''>('')
  const [destBinSite, setDestBinSite] = useState('')
  const [destBinNumber, setDestBinNumber] = useState('')
  const [destElevator, setDestElevator] = useState('')
  const [destOther, setDestOther] = useState('')

  const selectedType = taskTypes.find((t) => t.id === typeId)
  const selectedField = fields.find((f) => f.id === fieldId)
  const isHauling = selectedType?.name === 'Hauling'
  const fieldsForSection = useMemo(
    () => (section ? fieldsInSection(fields, section) : []),
    [fields, section],
  )
  const groupsForType = useMemo(
    () => defaultGroups.filter((g) => g.task_type_id === typeId),
    [defaultGroups, typeId],
  )

  // Equipment grouped by category (restricted to what a Hauling/Harvest task
  // actually uses, when applicable); Crew grouped by division (Ufer first).
  const equipmentCategories = equipmentCategoriesForTaskType(selectedType?.name)
  const equipmentGroups = useMemo(
    () => groupAssetsByCategory(resources, equipmentCategories),
    [resources, equipmentCategories],
  )
  const crewGroups = useMemo(() => groupEmployeesByDivision(resources), [resources])

  function goTo(next: Screen) {
    setHistory((h) => [...h, screen])
    setScreen(next)
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h
      setScreen(h[h.length - 1])
      return h.slice(0, -1)
    })
  }

  function toggleResource(id: string) {
    if (pickedResources.has(id)) {
      setPickedResources((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }
    // Checking something that has a default pairing (semi+trailer,
    // tractor+grain cart, ...) offers to bring its partner along too.
    const additions = [id]
    const resource = resources.find((r) => r.id === id)
    if (resource) {
      const partners = pairedWith(resource, pairings)
        .map((pid) => resources.find((r) => r.id === pid))
        .filter((r): r is Resource => !!r && !pickedResources.has(r.id))
      for (const partner of partners) {
        if (confirm(`${resource.name} is paired with ${partner.name}. Include ${partner.name} too?`)) {
          additions.push(partner.id)
        }
      }
    }
    setPickedResources((prev) => {
      const next = new Set(prev)
      for (const a of additions) next.add(a)
      return next
    })
  }

  function applyGroup(g: DefaultGroup) {
    setPickedResources(new Set(g.resource_ids))
    if (g.shift_start != null) setStartHour(g.shift_start)
    if (g.shift_end != null) setEndHour(g.shift_end < g.shift_start! ? g.shift_end + 24 : g.shift_end)
  }

  function originDescription(): string {
    if (originKind === 'field') return selectedField?.name ?? 'Field'
    if (originKind === 'bin') return originBinNumber ? `${originBinSite} ${originBinNumber}` : originBinSite
    return ''
  }

  function destDescription(): string {
    switch (destKind) {
      case 'home_wet_bin':
        return 'Home Farm Wet Bin'
      case 'lb_pork':
        return 'Delivery_LB_Pork'
      case 'bin':
        return destBinNumber ? `${destBinSite} ${destBinNumber}` : destBinSite
      case 'elevator':
        return destElevator
      case 'other':
        return destOther || 'Other'
      default:
        return ''
    }
  }

  function enterDetails() {
    if (!title) {
      if (isHauling) {
        const parts = [
          commodity ? `${commodity} Haul` : 'Hauling',
          originDescription() && `from ${originDescription()}`,
          destDescription() && `to ${destDescription()}`,
        ].filter(Boolean)
        setTitle(parts.join(' ') || 'Hauling task')
      } else {
        const parts = [selectedType?.name, selectedField?.name].filter(Boolean)
        setTitle(parts.join(' — ') || 'New task')
      }
    }
    goTo('details')
  }

  function selectType(t: TaskType) {
    setTypeId(t.id)
    goTo(t.name === 'Hauling' ? 'haul-commodity' : 'section')
  }

  function selectSection(s: FieldSection) {
    if (s !== section) setFieldId('')
    setSection(s)
    goTo('field')
  }

  function nextAfterField() {
    if (isHauling) goTo('haul-dest-choice')
    else goTo('equipment')
  }

  function selectCommodity(c: HaulCommodity) {
    setCommodity(c)
    goTo('haul-origin-choice')
  }

  function selectOriginChoice(kind: OriginKind) {
    setOriginKind(kind)
    goTo(kind === 'field' ? 'section' : 'haul-origin-bin-site')
  }

  function selectOriginBinSite(site: string) {
    setOriginBinSite(site)
    const s = BIN_SITES.find((b) => b.site === site)
    if (s && s.bins.length > 0) {
      goTo('haul-origin-bin-number')
    } else {
      setOriginBinNumber('')
      goTo('haul-dest-choice')
    }
  }

  function selectOriginBinNumber(n: string) {
    setOriginBinNumber(n)
    goTo('haul-dest-choice')
  }

  function selectDestChoice(kind: DestKind) {
    setDestKind(kind)
    if (kind === 'bin') goTo('haul-dest-bin-site')
    else if (kind === 'elevator') goTo('haul-dest-elevator')
    else if (kind === 'other') goTo('haul-dest-other')
    else goTo('equipment')
  }

  function selectDestBinSite(site: string) {
    setDestBinSite(site)
    const s = BIN_SITES.find((b) => b.site === site)
    if (s && s.bins.length > 0) {
      goTo('haul-dest-bin-number')
    } else {
      setDestBinNumber('')
      goTo('equipment')
    }
  }

  function selectDestBinNumber(n: string) {
    setDestBinNumber(n)
    goTo('equipment')
  }

  function selectElevator(name: string) {
    setDestElevator(name)
    goTo('equipment')
  }

  async function handleCreateField() {
    if (!newFieldName.trim() || !section) return
    try {
      const f = await onAddField(newFieldName.trim(), section)
      setFieldId(f.id)
      setNewFieldName('')
    } catch (e) {
      setError(errText(e))
    }
  }

  async function addResourceOfType(type: 'asset' | 'employee', category: string | null = null) {
    if (!newResName.trim()) return
    try {
      const r = await onAddResource({
        name: newResName.trim(),
        type,
        shift_start: null,
        shift_end: null,
        category,
      })
      setPickedResources((prev) => new Set(prev).add(r.id))
      setNewResName('')
    } catch (e) {
      setError(errText(e))
    }
  }

  function buildHaulDetails(): HaulDetails | null {
    if (!isHauling || !commodity || !originKind || !destKind) return null
    const origin: HaulLocation =
      originKind === 'field'
        ? { kind: 'field', field_id: fieldId || null }
        : { kind: 'bin', site: originBinSite, bin: originBinNumber || null }
    const destination: HaulLocation =
      destKind === 'home_wet_bin'
        ? { kind: 'home_farm_wet_bin' }
        : destKind === 'lb_pork'
          ? { kind: 'lb_pork_delivery' }
          : destKind === 'bin'
            ? { kind: 'bin', site: destBinSite, bin: destBinNumber || null }
            : destKind === 'elevator'
              ? { kind: 'elevator', name: destElevator }
              : { kind: 'other', note: destOther }
    return { commodity, origin, destination }
  }

  async function submit() {
    setError('')
    if (!typeId) return setError('Pick a task type.')
    if (!title.trim()) return setError('Give the task a name.')
    if (!allDay && endHour <= startHour) return setError('End time must be after start time.')
    setBusy(true)
    try {
      const haulDetails = buildHaulDetails()
      await onCreate(
        {
          title: title.trim(),
          task_type_id: typeId,
          field_id: isHauling ? (originKind === 'field' ? fieldId || null : null) : fieldId || null,
          task_date: taskDate,
          start_hour: allDay ? 0 : startHour,
          end_hour: allDay ? 24 : endHour,
          all_day: allDay,
          details: haulDetails,
        },
        [...pickedResources],
      )
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  const binSiteButtons = (onPick: (site: string) => void, active: string) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {BIN_SITES.map((b) => (
        <button key={b.site} onClick={() => onPick(b.site)} style={choiceStyle(active === b.site)}>
          {b.site}
        </button>
      ))}
    </div>
  )

  const binNumberButtons = (site: string, onPick: (n: string) => void, active: string) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {(BIN_SITES.find((b) => b.site === site)?.bins ?? []).map((n) => (
        <button key={n} onClick={() => onPick(n)} style={choiceStyle(active === n)}>
          {n}
        </button>
      ))}
    </div>
  )

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
          width: '540px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: C.serif,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'normal', color: C.heading }}>New Task</h2>
          <span style={{ fontSize: '11px', color: C.muted }}>{SCREEN_LABELS[screen]}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', margin: '10px 0 20px' }}>
          {Array.from({ length: Math.max(history.length + 1, 5) }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: '3px',
                borderRadius: '2px',
                backgroundColor: i <= history.length ? C.greenText : C.border,
              }}
            />
          ))}
        </div>

        {/* Type */}
        {screen === 'type' && (
          <div>
            <Label>Task type</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {taskTypes.map((t) => (
                <button key={t.id} onClick={() => selectType(t)} style={choiceStyle(typeId === t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hauling — Commodity */}
        {screen === 'haul-commodity' && (
          <div>
            <Label>What&apos;s being hauled?</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {HAUL_COMMODITIES.map((c) => (
                <button key={c} onClick={() => selectCommodity(c)} style={choiceStyle(commodity === c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hauling — Origin choice */}
        {screen === 'haul-origin-choice' && (
          <div>
            <Label>Hauling from</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button onClick={() => selectOriginChoice('field')} style={choiceStyle(originKind === 'field')}>
                From Field
              </button>
              <button onClick={() => selectOriginChoice('bin')} style={choiceStyle(originKind === 'bin')}>
                From Bin
              </button>
            </div>
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {/* Hauling — origin bin site / number (also reused for destination below) */}
        {screen === 'haul-origin-bin-site' && (
          <div>
            <Label>Origin bin</Label>
            {binSiteButtons(selectOriginBinSite, originBinSite)}
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}
        {screen === 'haul-origin-bin-number' && (
          <div>
            <Label>{originBinSite} — bin #</Label>
            {binNumberButtons(originBinSite, selectOriginBinNumber, originBinNumber)}
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {/* Section (shared: plain Field step, and Hauling's From-Field origin) */}
        {screen === 'section' && (
          <div>
            <Label>Section</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {FIELD_SECTIONS.map((s) => (
                <button key={s.key} onClick={() => selectSection(s.key)} style={choiceStyle(section === s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {/* Field */}
        {screen === 'field' && (
          <div>
            <Label>
              Field
              {section && (
                <span style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {' '}
                  — {FIELD_SECTIONS.find((s) => s.key === section)?.label}
                </span>
              )}
            </Label>
            <select
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              style={{ ...inputStyle, marginBottom: '10px' }}
            >
              <option value="">No field / general</option>
              {fieldsForSection.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {fieldsForSection.length === 0 && (
              <div style={{ fontSize: '11px', color: C.muted, marginBottom: '10px' }}>
                No fields in this section yet — add one below.
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
              <input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="+ Add a field"
                style={inputStyle}
              />
              <button onClick={handleCreateField} style={ghostBtn}>
                Add
              </button>
            </div>
            <StepNav
              onBack={goBack}
              onNext={nextAfterField}
              nextLabel={isHauling ? 'Next: destination' : 'Next: equipment'}
            />
          </div>
        )}

        {/* Hauling — Destination choice (options depend on origin kind) */}
        {screen === 'haul-dest-choice' && (
          <div>
            <Label>Destination</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {originKind === 'field' ? (
                <>
                  <button onClick={() => selectDestChoice('home_wet_bin')} style={choiceStyle(destKind === 'home_wet_bin')}>
                    Home Farm Wet Bin
                  </button>
                  <button onClick={() => selectDestChoice('lb_pork')} style={choiceStyle(destKind === 'lb_pork')}>
                    Delivery_LB_Pork
                  </button>
                  <button onClick={() => selectDestChoice('bin')} style={choiceStyle(destKind === 'bin')}>
                    Bin
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => selectDestChoice('bin')} style={choiceStyle(destKind === 'bin')}>
                    Bin
                  </button>
                  <button onClick={() => selectDestChoice('elevator')} style={choiceStyle(destKind === 'elevator')}>
                    Elevator Sale
                  </button>
                  <button onClick={() => selectDestChoice('other')} style={choiceStyle(destKind === 'other')}>
                    Other
                  </button>
                </>
              )}
            </div>
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {screen === 'haul-dest-bin-site' && (
          <div>
            <Label>Destination bin</Label>
            {binSiteButtons(selectDestBinSite, destBinSite)}
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}
        {screen === 'haul-dest-bin-number' && (
          <div>
            <Label>{destBinSite} — bin #</Label>
            {binNumberButtons(destBinSite, selectDestBinNumber, destBinNumber)}
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {screen === 'haul-dest-elevator' && (
          <div>
            <Label>Elevator</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {ELEVATORS.map((e) => (
                <button key={e} onClick={() => selectElevator(e)} style={choiceStyle(destElevator === e)}>
                  {e}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '18px' }}>
              <StepNav onBack={goBack} onNext={() => {}} nextLabel="" hideNext />
            </div>
          </div>
        )}

        {screen === 'haul-dest-other' && (
          <div>
            <Label>Other destination</Label>
            <input
              value={destOther}
              onChange={(e) => setDestOther(e.target.value)}
              placeholder="Describe the destination"
              style={{ ...inputStyle, marginBottom: '18px' }}
            />
            <StepNav onBack={goBack} onNext={() => goTo('equipment')} nextLabel="Next: equipment" />
          </div>
        )}

        {/* Equipment — grouped by category */}
        {screen === 'equipment' && (
          <div>
            {groupsForType.length > 0 && (
              <>
                <Label>Saved crews</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {groupsForType.map((g) => {
                    const memberNames = g.resource_ids
                      .map((id) => resources.find((r) => r.id === id)?.name)
                      .filter(Boolean)
                      .join(', ')
                    return (
                      <button
                        key={g.id}
                        onClick={() => applyGroup(g)}
                        title={memberNames || 'No members yet'}
                        style={ghostBtn}
                      >
                        {g.name}
                        <span style={{ color: C.muted, marginLeft: '6px' }}>({g.resource_ids.length})</span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize: '10px', color: '#4a5a3a', marginTop: '-8px', marginBottom: '14px' }}>
                  Applying a team fills equipment and crew — add or remove individual resources on either page afterward.
                </div>
              </>
            )}
            <Label>
              Equipment
              {equipmentCategories && (
                <span style={{ textTransform: 'none', letterSpacing: 0 }}> — {equipmentCategories.join(' / ')} only</span>
              )}
            </Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '260px', overflowY: 'auto' }}>
              {equipmentGroups.length === 0 && (
                <div style={{ fontSize: '12px', color: C.muted }}>
                  {equipmentCategories
                    ? `No ${equipmentCategories.join(' or ')} yet — add one below.`
                    : 'No equipment yet — add one below.'}
                </div>
              )}
              {equipmentGroups.map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '4px' }}>
                    {g.label} ({g.items.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {g.items.map((r) => (
                      <ResourceOption
                        key={r.id}
                        r={r}
                        picked={pickedResources.has(r.id)}
                        onToggle={toggleResource}
                        status={resourceStatusNow(r, taskDate, now, tasksForDate)}
                        dayOff={!isDayAvailable(r, taskDate)}
                        showStatus={isSameLocalDay(now, taskDate)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px', margin: '12px 0 18px' }}>
              {equipmentCategories && (
                <select
                  value={newAssetCategory || equipmentCategories[0]}
                  onChange={(e) => setNewAssetCategory(e.target.value)}
                  style={{ ...inputStyle, width: '110px' }}
                >
                  {equipmentCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={newResName}
                onChange={(e) => setNewResName(e.target.value)}
                placeholder="+ Add equipment"
                style={inputStyle}
              />
              <button
                onClick={() => addResourceOfType('asset', equipmentCategories ? newAssetCategory || equipmentCategories[0] : null)}
                style={ghostBtn}
              >
                Add
              </button>
            </div>
            <StepNav onBack={goBack} onNext={() => goTo('employees')} nextLabel="Next: crew" />
          </div>
        )}

        {/* Employees — grouped by division, Ufer before LB Pork */}
        {screen === 'employees' && (
          <div>
            <Label>Crew</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '260px', overflowY: 'auto' }}>
              {crewGroups.length === 0 && (
                <div style={{ fontSize: '12px', color: C.muted }}>No employees yet — add one below.</div>
              )}
              {crewGroups.map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a5a3a', marginBottom: '4px' }}>
                    {g.label} ({g.items.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {g.items.map((r) => (
                      <ResourceOption
                        key={r.id}
                        r={r}
                        picked={pickedResources.has(r.id)}
                        onToggle={toggleResource}
                        status={resourceStatusNow(r, taskDate, now, tasksForDate)}
                        dayOff={!isDayAvailable(r, taskDate)}
                        showStatus={isSameLocalDay(now, taskDate)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px', margin: '12px 0 18px' }}>
              <input
                value={newResName}
                onChange={(e) => setNewResName(e.target.value)}
                placeholder="+ Add an employee"
                style={inputStyle}
              />
              <button onClick={() => addResourceOfType('employee')} style={ghostBtn}>
                Add
              </button>
            </div>
            <StepNav onBack={goBack} onNext={enterDetails} nextLabel="Next: details" />
          </div>
        )}

        {/* Details */}
        {screen === 'details' && (
          <div>
            <Label>Task name</Label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '14px' }} />

            {isHauling && (originDescription() || destDescription()) && (
              <div style={{ fontSize: '11px', color: C.mutedBright, marginBottom: '14px' }}>
                {commodity} · {originDescription()} → {destDescription()}
              </div>
            )}

            <Label>Date</Label>
            <input
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              style={{ ...inputStyle, marginBottom: '14px' }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', color: C.text }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>

            {!allDay && (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <Label>Start</Label>
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                    style={inputStyle}
                  >
                    {HOUR_OPTIONS.filter((h) => h < 24).map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <Label>End</Label>
                  <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} style={inputStyle}>
                    {HOUR_OPTIONS.filter((h) => h > startHour).map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                        {h >= 24 ? ' (+1d)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={goBack} style={ghostBtn}>
                Back
              </button>
              <button onClick={submit} disabled={busy} style={primaryBtn}>
                {busy ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </div>
        )}

        {error && screen !== 'details' && (
          <div style={{ color: '#ff6b6b', fontSize: '13px', marginTop: '12px' }}>{error}</div>
        )}

        <div style={{ marginTop: '18px', textAlign: 'right' }}>
          <button onClick={onClose} style={{ ...ghostBtn, borderColor: 'transparent' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: C.muted,
        marginBottom: '8px',
      }}
    >
      {children}
    </div>
  )
}

export function ResourceOption({
  r,
  picked,
  onToggle,
  status,
  dayOff,
  showStatus,
}: {
  r: Resource
  picked: boolean
  onToggle: (id: string) => void
  status: ResourceStatus
  dayOff: boolean
  showStatus: boolean
}) {
  return (
    <button
      onClick={() => onToggle(r.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        borderRadius: '4px',
        cursor: 'pointer',
        textAlign: 'left',
        border: `1px solid ${picked ? C.greenText : C.border}`,
        background: picked ? '#1a2a1a' : 'transparent',
        color: C.text,
        fontSize: '13px',
      }}
    >
      <span
        style={{
          width: '14px',
          height: '14px',
          borderRadius: '3px',
          border: `1px solid ${picked ? C.greenText : C.border}`,
          background: picked ? C.greenText : 'transparent',
          color: C.bg,
          fontSize: '10px',
          lineHeight: '12px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {picked ? '✓' : ''}
      </span>
      <span style={{ flex: 1 }}>
        {r.name}
        <span style={{ color: C.muted, fontSize: '11px', marginLeft: '6px' }}>
          {formatShiftWindow(r.shift_start, r.shift_end)}
          {r.available_days && r.available_days.length > 0 && r.available_days.length < 7 && (
            <> · {formatAvailableDays(r.available_days)}</>
          )}
        </span>
      </span>
      {dayOff ? (
        <span style={{ fontSize: '10px', color: STATUS_COLOR['off-shift'] }}>not scheduled</span>
      ) : (
        showStatus &&
        status !== 'available' && <span style={{ fontSize: '10px', color: STATUS_COLOR[status] }}>{status}</span>
      )}
    </button>
  )
}

export function choiceStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    border: `1px solid ${active ? C.greenText : C.border}`,
    background: active ? '#1a2a1a' : 'transparent',
    color: active ? C.greenText : C.text,
  }
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  hideNext,
}: {
  onBack: () => void
  onNext: () => void
  nextLabel: string
  hideNext?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <button onClick={onBack} style={ghostBtn}>
        Back
      </button>
      {!hideNext && (
        <button onClick={onNext} style={primaryBtn}>
          {nextLabel}
        </button>
      )}
    </div>
  )
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong.'
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  backgroundColor: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: '4px',
  fontSize: '14px',
  fontFamily: C.serif,
  boxSizing: 'border-box',
}

export const primaryBtn: React.CSSProperties = {
  padding: '8px 18px',
  backgroundColor: C.green,
  border: 'none',
  color: '#fff',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

export const ghostBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: 'none',
  border: `1px solid ${C.border}`,
  color: C.muted,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
}

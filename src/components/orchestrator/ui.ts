// Shared visual constants for the orchestrator components. Matches the palette
// used across the rest of FieldOpsManager (see app/page.tsx / AddOperationModal).

export const C = {
  bg: '#0f1410',
  panel: '#111612',
  panelAlt: '#0a0f0b',
  border: '#2a3020',
  borderLight: '#1a2016',
  text: '#e8ead5',
  heading: '#c8d4a0',
  muted: '#6b7a5a',
  mutedBright: '#8a9a6a',
  green: '#2d6a2d',
  greenText: '#6aaa6a',
  blue: '#1a2a3a',
  blueText: '#aac8ff',
  amber: '#5a4800',
  amberText: '#aa8833',
  warnBg: '#5a3800',
  warnText: '#ffcc66',
  danger: '#6b1a1a',
  dangerText: '#ffaaaa',
  serif: "'Georgia', serif",
} as const

export const TASK_TYPE_COLOR: Record<string, string> = {
  Harvest: '#c8a02c',
  Tillage: '#8a5a3a',
  Hauling: '#3a6a8a',
  Manure: '#6a5a2a',
  Other: '#5a6a5a',
}

export function taskTypeColor(name: string | undefined): string {
  return (name && TASK_TYPE_COLOR[name]) || '#5a6a5a'
}

export const btn = {
  primary: {
    padding: '8px 16px',
    backgroundColor: C.green,
    border: 'none',
    color: '#fff',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  ghost: {
    padding: '7px 14px',
    background: 'none',
    border: `1px solid ${C.border}`,
    color: C.muted,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
} as const

export const STATUS_COLOR = {
  available: C.greenText,
  busy: '#e0524f',
  'off-shift': C.muted,
  conflict: '#ff3b3b',
} as const

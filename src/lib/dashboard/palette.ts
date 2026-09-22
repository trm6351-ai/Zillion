/**
 * Shared enterprise chart palette.
 * Colors are visual only — they do not change chart selection or values.
 * Zillion green is the brand color, not the only chart color.
 */

export const CHART_PALETTE = [
  '#16A34A',
  '#2563EB',
  '#7C3AED',
  '#EA580C',
  '#0F766E',
  '#D97706',
  '#DC2626',
] as const

export const CHART_MUTED = '#94A3B8'
export const CHART_TICK = '#64748B'
export const CHART_AXIS = 'rgba(31, 41, 55, 0.12)'
export const CHART_GRID = 'rgba(31, 41, 55, 0.07)'
export const CHART_CURSOR_FILL = 'rgba(37, 99, 235, 0.07)'
export const CHART_CURSOR_LINE = 'rgba(37, 99, 235, 0.28)'
export const CHART_TOOLTIP_FALLBACK = '#16A34A'

const SEMANTIC_EXACT: Record<string, string> = {
  north: '#2563EB',
  south: '#EA580C',
  west: '#7C3AED',
  central: '#16A34A',
  east: '#0F766E',
  equipment: '#2563EB',
  fuel: '#EA580C',
  maintenance: '#7C3AED',
  services: '#0F766E',
  service: '#0F766E',
  paid: '#16A34A',
  processing: '#2563EB',
  received: '#0F766E',
  completed: '#16A34A',
  complete: '#16A34A',
  healthy: '#16A34A',
  success: '#16A34A',
  partial: '#2563EB',
  pending: '#D97706',
  delayed: '#DC2626',
  delay: '#DC2626',
  overdue: '#DC2626',
  failed: '#DC2626',
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#0F766E',
  warning: '#D97706',
}

const SEMANTIC_PATTERNS: Array<[RegExp, string]> = [
  [/\bpaid\b/, '#16A34A'],
  [/\bprocessing\b/, '#2563EB'],
  [/\breceived\b/, '#0F766E'],
  [/\bon[\s-]?time\b/, '#16A34A'],
  [/\bcompleted?\b/, '#16A34A'],
  [/\bhealthy\b/, '#16A34A'],
  [/\bnorth\b/, '#2563EB'],
  [/\bsouth\b/, '#EA580C'],
  [/\bwest\b/, '#7C3AED'],
  [/\bcentral\b/, '#16A34A'],
  [/\beast\b/, '#0F766E'],
  [/\bpartial\b/, '#2563EB'],
  [/\bpending\b/, '#D97706'],
  [/\bdelayed?\b/, '#DC2626'],
  [/\boverdue\b/, '#DC2626'],
  [/\bfailed\b/, '#DC2626'],
  [/\bcritical\b/, '#DC2626'],
  [/\bhigh\b/, '#EA580C'],
  [/\bmedium\b/, '#D97706'],
  [/\blow\b/, '#0F766E'],
  [/\bequipment\b/, '#2563EB'],
  [/\bfuel\b/, '#EA580C'],
  [/\bmaintenance\b/, '#7C3AED'],
  [/\bservices?\b/, '#0F766E'],
]

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function chartColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

export function categoryColor(label: string, index: number): string {
  const normalized = normalizeLabel(label)

  if (normalized === 'other') {
    return CHART_MUTED
  }

  const exact = SEMANTIC_EXACT[normalized]
  if (exact) {
    return exact
  }

  for (const [pattern, color] of SEMANTIC_PATTERNS) {
    if (pattern.test(normalized)) {
      return color
    }
  }

  return chartColor(index)
}

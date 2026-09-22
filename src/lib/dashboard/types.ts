import type { ColumnProfile } from '../excel'

export type Aggregation = 'sum' | 'average' | 'count' | 'distinctCount'

export type KpiUnit = 'currency' | 'percent' | 'percentFraction' | 'count' | 'none'

export type ChartKind = 'line' | 'bar' | 'donut'

export type ChartSlot = 'overview' | 'trend' | 'breakdown'

export type DashboardNoticeCode = 'no-rows' | 'no-numeric-kpis' | 'no-charts'

export type DashboardNotice = {
  code: DashboardNoticeCode
  message: string
}

export type KpiCard = {
  id: string
  /** Source column, or null for dataset-level metrics such as record count. */
  columnKey: string | null
  name: string
  aggregation: Aggregation
  value: number
  unit: KpiUnit
  /** ISO currency symbol when detected from the column, otherwise null. */
  currencySymbol: string | null
  description: string
}

export type ChartSeries = {
  key: string
  name: string
  color: string
}

export type ChartDatum = {
  label: string
  values: Record<string, number>
}

export type DashboardChart = {
  id: string
  kind: ChartKind
  slot: ChartSlot
  title: string
  description: string
  xLabel: string | null
  yLabel: string | null
  series: ChartSeries[]
  data: ChartDatum[]
  unit: KpiUnit
  currencySymbol: string | null
  aggregation: Aggregation
}

export type DashboardModel = {
  fileName: string
  sheetName: string
  sheetCount: number
  recordCount: number
  columnCount: number
  kpis: KpiCard[]
  charts: DashboardChart[]
  /** Column keys to show in the preview table, in display order. */
  tableColumns: ColumnProfile[]
  notice: DashboardNotice | null
}

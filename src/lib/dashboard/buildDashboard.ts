import { getActiveSheet } from '../excel'
import type { WorkbookDataset } from '../excel'
import { selectCharts } from './charts'
import { detectKpis } from './kpis'
import { selectTableColumns } from './table'
import type { DashboardModel, DashboardNotice } from './types'

function buildNotice(
  recordCount: number,
  measureKpis: number,
  chartCount: number,
): DashboardNotice | null {
  if (recordCount === 0) {
    return {
      code: 'no-rows',
      message:
        'This sheet has no records to analyse. Choose another sheet, or upload a workbook that contains data rows.',
    }
  }

  if (measureKpis === 0) {
    return {
      code: 'no-numeric-kpis',
      message:
        'No numeric business KPI was detected. Identifier-like numbers are excluded, and this file appears to contain text or codes rather than measurable values.',
    }
  }

  if (chartCount === 0) {
    return {
      code: 'no-charts',
      message:
        'No meaningful visualizations can be generated from this dataset yet.',
    }
  }

  return null
}

/**
 * Builds the verified dashboard model from a parsed workbook.
 * Every figure is aggregated from the dataset — nothing is estimated or filled in.
 */
export function buildDashboard(dataset: WorkbookDataset): DashboardModel {
  const sheet = getActiveSheet(dataset)
  const kpis = detectKpis(sheet)
  const charts = selectCharts(sheet, kpis)
  const tableColumns = selectTableColumns(sheet)
  const measureKpis = kpis.filter((kpi) => kpi.columnKey !== null && kpi.aggregation !== 'distinctCount').length

  return {
    fileName: dataset.fileName,
    sheetName: sheet.name,
    sheetCount: dataset.sheets.length,
    recordCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    kpis,
    charts,
    tableColumns,
    notice: buildNotice(sheet.rowCount, measureKpis, charts.length),
  }
}

import { useMemo } from 'react'
import { buildDashboard } from '../lib/dashboard'
import type { DashboardModel } from '../lib/dashboard'
import type { WorkbookDataset } from '../lib/excel'

export function useDashboard(dataset: WorkbookDataset): DashboardModel {
  return useMemo(() => buildDashboard(dataset), [dataset])
}

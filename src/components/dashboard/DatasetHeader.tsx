import { SpreadsheetIcon } from '../SpreadsheetIcon'
import { PrimaryButton } from '../PrimaryButton'
import { formatCount } from '../../lib/excel'
import type { WorkbookDataset } from '../../lib/excel'
import type { DashboardModel } from '../../lib/dashboard'
import styles from './DatasetHeader.module.css'

type DatasetHeaderProps = {
  dashboard: DashboardModel
  comparisonDataset: WorkbookDataset | null
  onChangeFile: () => void
}

export function DatasetHeader({
  dashboard,
  comparisonDataset,
  onChangeFile,
}: DatasetHeaderProps) {
  const shape = [
    `${formatCount(dashboard.recordCount)} records`,
    `${formatCount(dashboard.columnCount)} columns`,
    dashboard.sheetCount > 1 ? dashboard.sheetName : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <span className={styles.icon}>
          <SpreadsheetIcon size={22} />
        </span>
        <div className={styles.meta}>
          <p className={styles.kicker}>Dataset</p>
          <h1 className={styles.fileName} title={dashboard.fileName}>
            {dashboard.fileName}
          </h1>
          <p className={styles.shape}>{shape}</p>
        </div>
        <PrimaryButton variant="ghost" onClick={onChangeFile}>
          Change File
        </PrimaryButton>
      </div>

      <p className={styles.trust}>
        Dashboard figures are calculated from this uploaded workbook only.
      </p>

      {comparisonDataset ? (
        <p className={styles.comparison}>
          Comparison file available
          <span>{comparisonDataset.fileName}</span>
        </p>
      ) : null}
    </header>
  )
}

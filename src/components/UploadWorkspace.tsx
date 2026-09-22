import { AnalysisFlow } from './AnalysisFlow'
import { ComparisonUploadCard } from './ComparisonUploadCard'
import { DatasetPanel } from './DatasetPanel'
import { EmptyState } from './EmptyState'
import { ExcelUploadCard } from './ExcelUploadCard'
import { PrimaryButton } from './PrimaryButton'
import { ZillionLogo } from './ZillionLogo'
import { formatCount, getActiveSheet } from '../lib/excel'
import type { WorkbookSlot, WorkbookSlotStatus } from '../hooks/useWorkbookSlot'
import styles from './UploadWorkspace.module.css'

type UploadWorkspaceProps = {
  main: WorkbookSlot
  comparison: WorkbookSlot
  comparisonOpen: boolean
  onOpenComparison: () => void
  onCloseComparison: () => void
  onAnalyze: () => void
}

/** The upload card only renders the states that come before a dataset exists. */
function uploadStatus(status: WorkbookSlotStatus): Exclude<WorkbookSlotStatus, 'ready'> {
  return status === 'ready' ? 'empty' : status
}

export function UploadWorkspace({
  main,
  comparison,
  comparisonOpen,
  onOpenComparison,
  onCloseComparison,
  onAnalyze,
}: UploadWorkspaceProps) {
  const mainDataset = main.status === 'ready' ? main.dataset : null
  const canAnalyze = mainDataset !== null

  const closeComparison = () => {
    comparison.clear()
    onCloseComparison()
  }

  return (
    <section className={styles.workspace}>
      <div className={canAnalyze ? `${styles.inner} ${styles.wide}` : styles.inner}>
        {mainDataset ? (
          <header className={styles.loadedHead}>
            <p className={styles.kicker}>Data loaded</p>
            <h1 className={styles.loadedTitle}>
              {formatCount(getActiveSheet(mainDataset).rowCount)} rows ready to review
            </h1>
            <p className={styles.loadedSubtitle}>
              Check the preview below, then analyze the data. Your file stays on this
              device and is never changed.
            </p>
          </header>
        ) : (
          <div className={styles.hero}>
            <ZillionLogo size={48} />
            <EmptyState
              kicker="Start here"
              title="Upload your Excel data"
              subtitle="Turn operational data into dashboards and AI-powered business insights."
            />
          </div>
        )}

        <AnalysisFlow
          current={mainDataset ? 'dashboard' : 'data'}
          completed={mainDataset ? ['data'] : []}
        />

        <div className={styles.stack}>
          {mainDataset ? (
            <DatasetPanel
              dataset={mainDataset}
              label="Main data"
              onSelectSheet={main.chooseSheet}
              onReplace={main.load}
              onRemove={main.clear}
            />
          ) : (
            <ExcelUploadCard
              status={uploadStatus(main.status)}
              fileName={main.fileName}
              fileSize={main.fileSize}
              error={main.error}
              onFileSelect={main.load}
              onDismissError={main.clear}
              title="Upload Excel data"
              hint="Drag and drop, or choose a file"
              inputLabel="Upload Excel data"
            />
          )}

          {comparison.status === 'ready' && comparison.dataset ? (
            <DatasetPanel
              compact
              optional
              dataset={comparison.dataset}
              label="Comparison data"
              onSelectSheet={comparison.chooseSheet}
              onReplace={comparison.load}
              onRemove={closeComparison}
            />
          ) : (
            <ComparisonUploadCard
              open={comparisonOpen}
              status={uploadStatus(comparison.status)}
              fileName={comparison.fileName}
              fileSize={comparison.fileSize}
              error={comparison.error}
              onOpen={onOpenComparison}
              onClose={closeComparison}
              onFileSelect={comparison.load}
              onDismissError={comparison.clear}
            />
          )}
        </div>

        <div className={styles.actions}>
          <PrimaryButton
            className={styles.analyze}
            onClick={onAnalyze}
            disabled={!canAnalyze}
          >
            Analyze Data
          </PrimaryButton>
          <p className={styles.helper}>
            {canAnalyze
              ? 'Next: build the dashboard, then generate AI review, attention areas, and recommendations.'
              : 'Add a main Excel file to enable analysis.'}
          </p>
        </div>
      </div>
    </section>
  )
}

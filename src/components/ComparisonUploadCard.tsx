import { ExcelUploadCard } from './ExcelUploadCard'
import { PrimaryButton } from './PrimaryButton'
import type { WorkbookError } from '../lib/excel'
import type { WorkbookSlotStatus } from '../hooks/useWorkbookSlot'
import styles from './ComparisonUploadCard.module.css'

type ComparisonUploadCardProps = {
  open: boolean
  /** A loaded comparison file is rendered by DatasetPanel instead. */
  status: Exclude<WorkbookSlotStatus, 'ready'>
  fileName: string | null
  fileSize: number | null
  error: WorkbookError | null
  onOpen: () => void
  onClose: () => void
  onFileSelect: (file: File) => void
  onDismissError: () => void
}

export function ComparisonUploadCard({
  open,
  status,
  fileName,
  fileSize,
  error,
  onOpen,
  onClose,
  onFileSelect,
  onDismissError,
}: ComparisonUploadCardProps) {
  if (!open) {
    return (
      <div className={styles.wrap}>
        <div className={styles.collapsed}>
          <PrimaryButton variant="quiet" onClick={onOpen}>
            Add comparison file
          </PrimaryButton>
          <p className={styles.note}>
            Optional — add a second workbook to compare periods, targets, or datasets.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.expanded}>
        <div className={styles.expandedHead}>
          <p className={styles.label}>
            Comparison data
            <span className={styles.optional}>Optional</span>
          </p>
          <PrimaryButton variant="quiet" onClick={onClose}>
            Remove
          </PrimaryButton>
        </div>
        <ExcelUploadCard
          variant="compact"
          status={status}
          fileName={fileName}
          fileSize={fileSize}
          error={error}
          onFileSelect={onFileSelect}
          onDismissError={onDismissError}
          title="Upload comparison file"
          hint="Optional second Excel workbook"
          inputLabel="Upload comparison Excel file"
        />
      </div>
    </div>
  )
}

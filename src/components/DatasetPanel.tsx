import { useRef, type ChangeEvent } from 'react'
import { DataPreviewTable } from './DataPreviewTable'
import { DataStructureSummary } from './DataStructureSummary'
import { DatasetNotes } from './DatasetNotes'
import { SheetTabs } from './SheetTabs'
import { SpreadsheetIcon } from './SpreadsheetIcon'
import { useFileDrop } from '../hooks/useFileDrop'
import { formatFileSize, getExcelAccept } from '../lib/files'
import type { WorkbookDataset } from '../lib/excel'
import { formatCount, getActiveSheet } from '../lib/excel'
import styles from './DatasetPanel.module.css'

type DatasetPanelProps = {
  dataset: WorkbookDataset
  label: string
  /** Marks the comparison slot, which the app can run without. */
  optional?: boolean
  compact?: boolean
  onSelectSheet: (sheetId: string) => void
  onReplace: (file: File) => void
  onRemove: () => void
}

export function DatasetPanel({
  dataset,
  label,
  optional = false,
  compact = false,
  onSelectSheet,
  onReplace,
  onRemove,
}: DatasetPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const sheet = getActiveSheet(dataset)
  const notes = [...dataset.notes, ...sheet.notes]

  const { isDragging, dropHandlers } = useFileDrop({ onFile: onReplace })

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.item(0)
    if (nextFile) {
      onReplace(nextFile)
    }
    event.target.value = ''
  }

  const panelClass = [
    styles.panel,
    compact ? styles.compact : '',
    isDragging ? styles.dragging : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={panelClass} {...dropHandlers}>
      <input
        ref={inputRef}
        className={styles.input}
        type="file"
        accept={getExcelAccept()}
        aria-label={`Replace ${label.toLowerCase()} Excel file`}
        tabIndex={-1}
        onChange={onInputChange}
      />

      <header className={styles.head}>
        <p className={styles.label}>
          {label}
          {optional ? <span className={styles.optional}>Optional</span> : null}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.quiet}`}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </header>

      <div className={styles.file}>
        <span className={styles.fileIcon}>
          <SpreadsheetIcon size={compact ? 18 : 22} />
        </span>
        <div className={styles.fileMeta}>
          <p className={styles.fileName} title={dataset.fileName}>
            {dataset.fileName}
          </p>
          <p className={styles.fileSize}>
            {formatFileSize(dataset.fileSize)} · read in your browser
          </p>
        </div>
      </div>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Rows</dt>
          <dd>{formatCount(sheet.rowCount)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Columns</dt>
          <dd>{formatCount(sheet.columnCount)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Sheets</dt>
          <dd>{formatCount(dataset.sheets.length)}</dd>
        </div>
      </dl>

      <SheetTabs
        sheets={dataset.sheets}
        activeSheetId={dataset.activeSheetId}
        onSelect={onSelectSheet}
      />

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Data preview</p>
        <DataPreviewTable sheet={sheet} maxRows={compact ? 4 : 8} />
      </div>

      {sheet.isEmpty ? null : (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Data structure</p>
          <DataStructureSummary structure={sheet.structure} />
        </div>
      )}

      {notes.length > 0 ? (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>What we noticed</p>
          <DatasetNotes notes={notes} />
        </div>
      ) : null}
    </section>
  )
}

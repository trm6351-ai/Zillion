import { useId, useRef, type ChangeEvent } from 'react'
import { SpreadsheetIcon } from './SpreadsheetIcon'
import { useFileDrop } from '../hooks/useFileDrop'
import { formatFileSize, getExcelAccept } from '../lib/files'
import type { WorkbookError } from '../lib/excel'
import type { WorkbookSlotStatus } from '../hooks/useWorkbookSlot'
import styles from './ExcelUploadCard.module.css'

type ExcelUploadCardProps = {
  /** A loaded slot is rendered by DatasetPanel, so 'ready' never reaches here. */
  status: Exclude<WorkbookSlotStatus, 'ready'>
  fileName: string | null
  fileSize: number | null
  error: WorkbookError | null
  onFileSelect: (file: File) => void
  onDismissError: () => void
  variant?: 'primary' | 'compact'
  title: string
  hint: string
  inputLabel: string
}

function WarningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4.5 21 20H3L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v4.2M12 17.1h.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ExcelUploadCard({
  status,
  fileName,
  fileSize,
  error,
  onFileSelect,
  onDismissError,
  variant = 'primary',
  title,
  hint,
  inputLabel,
}: ExcelUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const hintId = useId()
  const isReading = status === 'reading'
  const hasError = status === 'error'
  const interactive = status === 'empty'

  const { isDragging, dropHandlers } = useFileDrop({
    enabled: !isReading,
    onFile: onFileSelect,
  })

  const openPicker = () => {
    inputRef.current?.click()
  }

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.item(0)
    if (nextFile) {
      onFileSelect(nextFile)
    }
    event.target.value = ''
  }

  const cardClass = [
    styles.card,
    styles[variant],
    isDragging ? styles.dragging : '',
    isReading ? styles.reading : '',
    hasError ? styles.errored : '',
  ]
    .filter(Boolean)
    .join(' ')

  const fileInput = (
    <input
      id={inputId}
      ref={inputRef}
      className={styles.input}
      type="file"
      accept={getExcelAccept()}
      aria-label={inputLabel}
      aria-describedby={interactive ? hintId : undefined}
      tabIndex={interactive ? 0 : -1}
      onChange={onInputChange}
    />
  )

  const body = (
    <>
      {fileInput}

      {isReading ? (
        <div className={styles.body} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.title}>Reading workbook</p>
          <p className={styles.hint}>{fileName ?? 'Your file'}</p>
          <p className={styles.formats}>
            {fileSize !== null ? `${formatFileSize(fileSize)} · ` : ''}
            Checking sheets, columns, and data types.
          </p>
        </div>
      ) : null}

      {hasError && error ? (
        <div className={styles.errorBody} role="alert">
          <span className={styles.errorIcon}>
            <WarningIcon />
          </span>
          <div className={styles.errorText}>
            <p className={styles.errorTitle}>{error.title}</p>
            {fileName ? (
              <p className={styles.errorHint}>
                {fileName}
                {fileSize !== null ? ` · ${formatFileSize(fileSize)}` : ''}
              </p>
            ) : null}
            <p className={styles.errorMessage}>{error.message}</p>
            <p className={styles.errorHint}>{error.hint}</p>
          </div>
          <div className={styles.errorActions}>
            <button type="button" className={styles.retry} onClick={openPicker}>
              Choose another file
            </button>
            <button type="button" className={styles.dismiss} onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {interactive ? (
        <div className={styles.body}>
          <div className={styles.icon}>
            <SpreadsheetIcon />
          </div>
          <p className={styles.title}>{title}</p>
          <p className={styles.hint}>{isDragging ? 'Drop your file to add it' : hint}</p>
          <span className={styles.choose}>Choose file</span>
          <p id={hintId} className={styles.formats}>
            Supported: .xlsx, .xls
          </p>
        </div>
      ) : null}
    </>
  )

  if (interactive) {
    return (
      <label className={cardClass} htmlFor={inputId} {...dropHandlers}>
        {body}
      </label>
    )
  }

  return (
    <div className={cardClass} aria-busy={isReading} {...dropHandlers}>
      {body}
    </div>
  )
}

const EXCEL_EXTENSIONS = ['.xlsx', '.xls'] as const

/** Workbooks are parsed in the browser, so very large files are rejected. */
export const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return EXCEL_EXTENSIONS.some((extension) => name.endsWith(extension))
}

export function getExcelAccept(): string {
  return '.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

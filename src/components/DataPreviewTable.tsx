import type { SheetDataset } from '../lib/excel'
import { ROLE_TAGS, formatCellValue, formatCount } from '../lib/excel'
import styles from './DataPreviewTable.module.css'

type DataPreviewTableProps = {
  sheet: SheetDataset
  maxRows?: number
  maxColumns?: number
}

export function DataPreviewTable({
  sheet,
  maxRows = 8,
  maxColumns = 12,
}: DataPreviewTableProps) {
  if (sheet.isEmpty || sheet.columns.length === 0) {
    return (
      <p className={styles.blank}>
        This sheet has no rows to preview. Pick another sheet, or upload a workbook
        with data underneath the headers.
      </p>
    )
  }

  const columns = sheet.columns.slice(0, maxColumns)
  const rows = sheet.rows.slice(0, maxRows)
  const hiddenColumns = sheet.columns.length - columns.length

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  <span className={styles.columnName} title={column.name}>
                    {column.name}
                  </span>
                  <span className={styles.columnType}>{ROLE_TAGS[column.role]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index}>
                {columns.map((column) => {
                  const value = row.cells[column.key] ?? null
                  const numeric = column.role === 'measure'

                  return (
                    <td
                      key={column.key}
                      className={numeric ? styles.numeric : undefined}
                    >
                      {formatCellValue(value, {
                        grouping: column.role !== 'identifier',
                      })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.caption}>
        Showing {formatCount(rows.length)} of {formatCount(sheet.rowCount)} rows
        {hiddenColumns > 0
          ? ` and ${formatCount(columns.length)} of ${formatCount(sheet.columnCount)} columns`
          : null}
        .
      </p>
    </div>
  )
}

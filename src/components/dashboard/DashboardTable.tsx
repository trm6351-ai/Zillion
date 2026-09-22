import { useMemo, useState } from 'react'
import { formatCellValue, formatCount, type DataRow, type SheetDataset } from '../../lib/excel'
import type { ColumnProfile } from '../../lib/excel'
import styles from './DashboardTable.module.css'

const PAGE_SIZE = 10

type DashboardTableProps = {
  sheet: SheetDataset
  columns: ColumnProfile[]
}

export function DashboardTable({ sheet, columns }: DashboardTableProps) {
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(sheet.rowCount / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)

  const rows = useMemo(() => {
    const start = safePage * PAGE_SIZE
    return sheet.rows.slice(start, start + PAGE_SIZE)
  }, [sheet.rows, safePage])

  const startRow = sheet.rowCount === 0 ? 0 : safePage * PAGE_SIZE + 1
  const endRow = Math.min((safePage + 1) * PAGE_SIZE, sheet.rowCount)

  if (sheet.isEmpty || columns.length === 0) {
    return (
      <section className={styles.panel} aria-label="Data table">
        <header className={styles.head}>
          <p className={styles.kicker}>Data table</p>
          <h2 className={styles.title}>Source rows</h2>
        </header>
        <p className={styles.blank}>No source rows are available to display from this sheet.</p>
      </section>
    )
  }

  return (
    <section className={styles.panel} aria-label="Data table">
      <header className={styles.head}>
        <p className={styles.kicker}>Data table</p>
        <h2 className={styles.title}>Source rows</h2>
        <p className={styles.description}>
          Original values from the uploaded file. Nothing has been changed or filled in.
        </p>
      </header>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TableRow key={row.index} row={row} columns={columns} />
            ))}
          </tbody>
        </table>
      </div>

      <footer className={styles.footer}>
        <p className={styles.caption}>
          Showing {formatCount(startRow)}–{formatCount(endRow)} of{' '}
          {formatCount(sheet.rowCount)} rows
        </p>
        {totalPages > 1 ? (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={safePage === 0}
            >
              Previous
            </button>
            <span className={styles.pageStatus}>
              {formatCount(safePage + 1)} / {formatCount(totalPages)}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Next
            </button>
          </div>
        ) : null}
      </footer>
    </section>
  )
}

function TableRow({ row, columns }: { row: DataRow; columns: ColumnProfile[] }) {
  return (
    <tr>
      {columns.map((column) => {
        const value = row.cells[column.key] ?? null
        const numeric = column.role === 'measure'

        return (
          <td key={column.key} className={numeric ? styles.numeric : undefined}>
            {formatCellValue(value, {
              grouping: column.role !== 'identifier',
            })}
          </td>
        )
      })}
    </tr>
  )
}

import type { SheetDataset } from '../lib/excel'
import { formatCount } from '../lib/excel'
import styles from './SheetTabs.module.css'

type SheetTabsProps = {
  sheets: SheetDataset[]
  activeSheetId: string
  onSelect: (sheetId: string) => void
}

export function SheetTabs({ sheets, activeSheetId, onSelect }: SheetTabsProps) {
  if (sheets.length <= 1) {
    return null
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label="Worksheets">
      {sheets.map((sheet) => {
        const selected = sheet.id === activeSheetId
        const classes = [
          styles.tab,
          selected ? styles.active : '',
          sheet.isEmpty ? styles.empty : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={classes}
            onClick={() => onSelect(sheet.id)}
          >
            <span className={styles.name}>{sheet.name}</span>
            <span className={styles.count}>
              {sheet.isEmpty ? 'empty' : formatCount(sheet.rowCount)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

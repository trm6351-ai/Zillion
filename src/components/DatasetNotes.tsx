import type { DatasetNote } from '../lib/excel'
import styles from './DatasetNotes.module.css'

type DatasetNotesProps = {
  notes: DatasetNote[]
}

/**
 * Everything the parser had to interpret is surfaced here, so no row, column,
 * or header is ever changed behind the user's back.
 */
export function DatasetNotes({ notes }: DatasetNotesProps) {
  if (notes.length === 0) {
    return null
  }

  return (
    <ul className={styles.list}>
      {notes.map((note, index) => (
        <li
          key={`${note.code}-${index}`}
          className={note.level === 'warning' ? styles.warning : styles.info}
        >
          <span className={styles.dot} aria-hidden="true" />
          {note.message}
        </li>
      ))}
    </ul>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorkbookError, loadWorkbookFile, selectSheet } from '../lib/excel'
import type { DatasetRole, WorkbookDataset, WorkbookError } from '../lib/excel'

export type WorkbookSlotStatus = 'empty' | 'reading' | 'ready' | 'error'

export type WorkbookSlotState = {
  status: WorkbookSlotStatus
  fileName: string | null
  fileSize: number | null
  dataset: WorkbookDataset | null
  error: WorkbookError | null
}

export type WorkbookSlot = WorkbookSlotState & {
  load: (file: File) => void
  clear: () => void
  chooseSheet: (sheetId: string) => void
}

const EMPTY_SLOT: WorkbookSlotState = {
  status: 'empty',
  fileName: null,
  fileSize: null,
  dataset: null,
  error: null,
}

/**
 * Holds one uploaded workbook and its prepared dataset.
 *
 * The app uses one slot for the main data and a second, optional slot for
 * comparison data, so the two files are read and stored entirely separately.
 */
export function useWorkbookSlot(role: DatasetRole): WorkbookSlot {
  const [state, setState] = useState<WorkbookSlotState>(EMPTY_SLOT)
  const requestRef = useRef(0)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  const load = useCallback(
    (file: File) => {
      requestRef.current += 1
      const requestId = requestRef.current

      setState({
        status: 'reading',
        fileName: file.name,
        fileSize: file.size,
        dataset: null,
        error: null,
      })

      const isStale = () => !activeRef.current || requestRef.current !== requestId

      void loadWorkbookFile(file, role)
        .then((result) => {
          if (isStale()) {
            return
          }

          setState({
            status: result.ok ? 'ready' : 'error',
            fileName: file.name,
            fileSize: file.size,
            dataset: result.ok ? result.value : null,
            error: result.ok ? null : result.error,
          })
        })
        .catch(() => {
          if (isStale()) {
            return
          }

          setState({
            status: 'error',
            fileName: file.name,
            fileSize: file.size,
            dataset: null,
            error: createWorkbookError('unknown'),
          })
        })
    },
    [role],
  )

  const clear = useCallback(() => {
    // Invalidates any read still in flight so a late result cannot reappear.
    requestRef.current += 1
    setState(EMPTY_SLOT)
  }, [])

  const chooseSheet = useCallback((sheetId: string) => {
    setState((previous) =>
      previous.dataset
        ? { ...previous, dataset: selectSheet(previous.dataset, sheetId) }
        : previous,
    )
  }, [])

  return { ...state, load, clear, chooseSheet }
}

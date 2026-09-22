import { buildWorkbookDataset } from './buildDataset'
import { classifyThrownError, fail, type Result } from './errors'
import { readWorkbookFile } from './readWorkbook'
import type { DatasetRole, WorkbookDataset } from './types'

/**
 * Reads an Excel file and returns the prepared dataset.
 *
 * This is the single entry point the UI uses. It never throws: every failure
 * comes back as a described error, and the uploaded file is only ever read.
 */
export async function loadWorkbookFile(
  file: File,
  role: DatasetRole,
): Promise<Result<WorkbookDataset>> {
  try {
    const raw = await readWorkbookFile(file)
    if (!raw.ok) {
      return raw
    }

    return buildWorkbookDataset(raw.value, {
      role,
      fileName: file.name,
      fileSize: file.size,
    })
  } catch (error) {
    return fail(classifyThrownError(error))
  }
}

/** Switches the visible sheet without re-reading or changing the data. */
export function selectSheet(
  dataset: WorkbookDataset,
  sheetId: string,
): WorkbookDataset {
  if (
    dataset.activeSheetId === sheetId ||
    !dataset.sheets.some((sheet) => sheet.id === sheetId)
  ) {
    return dataset
  }

  return { ...dataset, activeSheetId: sheetId }
}

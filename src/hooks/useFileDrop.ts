import { useCallback, useState, type DragEvent } from 'react'

type UseFileDropOptions = {
  enabled?: boolean
  onFile: (file: File) => void
}

export function useFileDrop({ enabled = true, onFile }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false)

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!enabled) {
        return
      }
      setIsDragging(true)
    },
    [enabled],
  )

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!enabled) {
        return
      }
      setIsDragging(true)
    },
    [enabled],
  )

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDragging(false)
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      if (!enabled) {
        return
      }

      const file = event.dataTransfer.files.item(0)
      if (file) {
        onFile(file)
      }
    },
    [enabled, onFile],
  )

  return {
    isDragging,
    dropHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}

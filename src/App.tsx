import { lazy, Suspense, useEffect, useState } from 'react'
import { AnalyzingState } from './components/AnalyzingState'
import { AppShell } from './components/AppShell'
import { UploadWorkspace } from './components/UploadWorkspace'
import { useWorkbookSlot } from './hooks/useWorkbookSlot'
import type { StatusTone, WorkspacePhase } from './types'

const ANALYSIS_PREP_MS = 1200

const InsightWorkspace = lazy(async () => {
  const module = await import('./components/InsightWorkspace')
  return { default: module.InsightWorkspace }
})

function getStatus(
  phase: WorkspacePhase,
  reading: boolean,
): { label: string; tone: StatusTone } {
  if (reading) {
    return { label: 'Reading file', tone: 'busy' }
  }
  if (phase === 'analyzing') {
    return { label: 'Analyzing', tone: 'busy' }
  }
  if (phase === 'insight') {
    return { label: 'AI Ready', tone: 'complete' }
  }
  return { label: 'AI Ready', tone: 'ready' }
}

function App() {
  const [phase, setPhase] = useState<WorkspacePhase>('upload')
  // The two workbooks are held in separate slots so the comparison file is
  // parsed and stored independently of the main dataset.
  const main = useWorkbookSlot('main')
  const comparison = useWorkbookSlot('comparison')
  const [comparisonOpen, setComparisonOpen] = useState(false)

  useEffect(() => {
    if (phase !== 'analyzing') {
      return
    }

    void import('./components/InsightWorkspace')

    const timeoutId = window.setTimeout(() => {
      setPhase('insight')
    }, ANALYSIS_PREP_MS)

    return () => window.clearTimeout(timeoutId)
  }, [phase])

  const reading = main.status === 'reading' || comparison.status === 'reading'
  const status = getStatus(phase, reading)

  return (
    <AppShell statusLabel={status.label} statusTone={status.tone}>
      {phase === 'upload' ? (
        <UploadWorkspace
          main={main}
          comparison={comparison}
          comparisonOpen={comparisonOpen}
          onOpenComparison={() => setComparisonOpen(true)}
          onCloseComparison={() => setComparisonOpen(false)}
          onAnalyze={() => {
            if (main.dataset) {
              setPhase('analyzing')
            }
          }}
        />
      ) : null}

      {phase === 'analyzing' ? <AnalyzingState /> : null}

      {phase === 'insight' && main.dataset ? (
        <Suspense fallback={<AnalyzingState />}>
          <InsightWorkspace
            mainDataset={main.dataset}
            comparisonDataset={comparison.dataset}
            onChangeFile={() => setPhase('upload')}
          />
        </Suspense>
      ) : null}
    </AppShell>
  )
}

export default App

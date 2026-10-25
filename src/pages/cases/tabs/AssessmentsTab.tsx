import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { variantFor } from '@/lib/constants'
import type { AssessmentSession } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { fmtDate } from '@/lib/utils'
import type { TabProps } from './types'

export const VALIDITY_LABEL: Record<string, string> = {
  fast_responses: 'Median response under 1.5 s',
  straight_lining: '10+ identical answers in a row',
  social_desirability: 'Social desirability above 80th percentile',
  divergence: 'Self vs. others divergence of 12+',
  incomplete: 'Many items unanswered',
}

export default function AssessmentsTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const variant = variantFor(c.track)
  const { data, error, loading, reload } = useAsync(async () => {
    const [instruments, sessions, results] = await Promise.all([api.instrumentsFor(variant), api.assessmentSessions(c.id), api.assessmentResults(c.id)])
    return { instruments, sessions, results }
  }, [c.id, variant])
  const [confirm, setConfirm] = useState<AssessmentSession | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <Card>
      <Table>
        <THead>
          <TR><TH>Instrument</TH><TH>Status</TH><TH>Completed</TH><TH>Duration</TH><TH>Validity</TH><TH /></TR>
        </THead>
        <TBody>
          {data!.instruments.map((i) => {
            const all = data!.sessions.filter((s) => s.instrument_id === i.id)
            const s = all.find((x) => x.status !== 'invalidated')
            const invalidated = all.filter((x) => x.status === 'invalidated').length
            const result = data!.results.find((r) => r.instrument_id === i.id)
            const flags = Object.entries(result?.validity_flags ?? {}).filter(([, v]) => v === true).map(([k]) => k)
            return (
              <TR key={i.id}>
                <TD>
                  <div className="font-semibold text-pine-900">{i.name}</div>
                  <div className="text-xs text-muted">{i.code} · v{i.version}{invalidated > 0 && ` · ${invalidated} earlier attempt${invalidated > 1 ? 's' : ''} invalidated`}</div>
                </TD>
                <TD>
                  {!s ? <Badge variant="outline">Not started</Badge> : s.status === 'completed' ? <Badge variant="ok">Completed</Badge> : <Badge variant="warn">In progress</Badge>}
                </TD>
                <TD className="text-sm">{fmtDate(s?.completed_at)}</TD>
                <TD className="text-sm">{s?.duration_sec ? `${Math.round(s.duration_sec / 60)} min` : '—'}</TD>
                <TD>
                  {!result ? <span className="text-sm text-muted">{s?.status === 'completed' ? 'Scoring…' : '—'}</span> : flags.length === 0 ? <Badge variant="ok">No flags</Badge> : (
                    <div className="flex flex-col items-start gap-1">
                      {flags.map((f) => <Badge key={f} variant="warn"><AlertTriangle className="size-3" /> {VALIDITY_LABEL[f] ?? f}</Badge>)}
                    </div>
                  )}
                </TD>
                <TD className="text-right">
                  {s && <Button size="sm" variant="outline" onClick={() => setConfirm(s)}><RotateCcw /> Re-administer</Button>}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>Re-administer this instrument?</DialogTitle>
          <DialogDescription>
            The current attempt is marked invalidated (kept for the record) and the candidate can start a fresh attempt. Scores from the new attempt replace these in matching.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={busy} onClick={async () => {
              setBusy(true)
              try { await api.reAdminister(confirm!.id); setConfirm(null); reload() } finally { setBusy(false) }
            }}>Invalidate and re-open</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

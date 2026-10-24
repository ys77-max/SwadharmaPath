import { ArrowLeft, Check, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import type { RefreshProposal } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { cn, fmtDateTime } from '@/lib/utils'
import { RunStatus, SCOPE_LABEL, SOURCE_LABEL } from './LibraryPage'

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', family: 'Family', riasec_code: 'RIASEC code', interest_weights: 'Interest weights (R I A S E C)', outlook: 'Outlook',
  automation_exposure: 'Automation exposure', description: 'Description', day_in_life: 'Day in the life', typical_entry_paths: 'Entry paths',
  adjacent_emerging: 'Adjacent and emerging', workstyle_fit: 'Work style fit', values_fit: 'Values fit', india_salary_band: 'Salary band (India)',
  aptitude_min: 'Minimum aptitude', pathways: 'Education pathways', board: 'Board', subjects: 'Subjects',
  keeps_open_families: 'Keeps open', closes_families: 'Closes', notes: 'Notes',
}

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === '') return <span className="text-muted">—</span>
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) return <span>{v.join(', ')}</span>
  if (typeof v === 'object') return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(v, null, 1)}</pre>
  return <span className="whitespace-pre-wrap">{String(v)}</span>
}

function ProposalCard({ p, editable, onDecide }: { p: RefreshProposal; editable: boolean; onDecide: (d: 'approved' | 'rejected' | 'pending') => void }) {
  return (
    <Card className={cn(p.decision === 'approved' && 'border-ok/50', p.decision === 'rejected' && 'opacity-60')}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          {p.entity_name}
          <Badge variant="outline">{p.entity === 'career' ? 'Career' : 'Stream'}</Badge>
          {!p.entity_id && <Badge variant="warn">New</Badge>}
          {p.decision !== 'pending' && <Badge variant={p.decision === 'approved' ? 'ok' : 'outline'} className="capitalize">{p.decision}</Badge>}
        </CardTitle>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant={p.decision === 'approved' ? 'default' : 'outline'} onClick={() => onDecide(p.decision === 'approved' ? 'pending' : 'approved')}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant={p.decision === 'rejected' ? 'secondary' : 'ghost'} onClick={() => onDecide(p.decision === 'rejected' ? 'pending' : 'rejected')}>
              <X /> Reject
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="w-44 py-1 pr-3 font-semibold">Field</th>
                <th className="py-1 pr-3 font-semibold">Now</th>
                <th className="py-1 font-semibold">Suggested</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p.changes).map(([f, c]) => (
                <tr key={f} className="border-t border-line align-top">
                  <td className="py-2 pr-3 font-semibold text-pine-900">{FIELD_LABEL[f] ?? f}</td>
                  <td className="py-2 pr-3 text-muted"><Value v={c.old} /></td>
                  <td className="py-2 text-pine-900"><Value v={c.new} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.rationale && <p className="text-sm text-ink">{p.rationale}</p>}
        {p.sources.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {p.sources.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-pine-700 hover:underline">
                    {s.title || s.url} <ExternalLink className="size-3" />
                  </a>
                ) : <span className="text-muted">{s.title}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default function RefreshReview() {
  const { id = '' } = useParams()
  const { data, error, loading, reload, setData } = useAsync(() => api.refreshRun(id), [id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)
  const status = data?.run.status

  useEffect(() => {
    if (status !== 'queued' && status !== 'running') return
    const t = setInterval(reload, 10_000)
    return () => clearInterval(t)
  }, [status, reload])

  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error ?? 'Not found'} />
  const { run, proposals } = data
  const editable = run.status === 'review'
  const approved = proposals.filter((p) => p.decision === 'approved').length
  const pending = proposals.filter((p) => p.decision === 'pending')

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const decide = (p: RefreshProposal, d: 'approved' | 'rejected' | 'pending') =>
    act(async () => {
      await api.decideProposal(p.id, d)
      setData({ run, proposals: proposals.map((x) => (x.id === p.id ? { ...x, decision: d } : x)) })
    })

  return (
    <div>
      <Link to="/admin/careers" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-pine-700 hover:underline">
        <ArrowLeft className="size-4" /> Library
      </Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Review library changes <RunStatus status={run.status} /></span>}
        subtitle={`${SOURCE_LABEL[run.source]} · ${SCOPE_LABEL[run.scope]} · started ${fmtDateTime(run.created_at)}`}
        actions={editable && (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => act(async () => { await api.cancelLibraryRefresh(run.id); await reload() })}>Cancel refresh</Button>
            {pending.length > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => act(async () => { for (const p of pending) await api.decideProposal(p.id, 'approved'); await reload() })}>
                Approve all {pending.length}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setConfirm(true)}>Apply {approved} approved</Button>
          </>
        )}
      />
      {err && <ErrorBox error={err} className="mb-4" />}
      {done !== null && (
        <div className="mb-4 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok" role="status">
          Applied {done} change(s). Every entry in scope is marked reviewed today, and matches are being recalculated for active candidates.
        </div>
      )}

      {(run.status === 'queued' || run.status === 'running') && (
        <Empty title="Checking sources…">
          The worker reviews each entry in turn; a full refresh takes about 15 to 30 minutes. You can leave this page; admins are notified
          when it is ready.
          <div className="mt-3"><Button variant="ghost" onClick={() => act(async () => { await api.cancelLibraryRefresh(run.id); await reload() })}>Cancel refresh</Button></div>
        </Empty>
      )}
      {run.status === 'failed' && <ErrorBox error={run.error ?? 'The refresh failed.'} className="mb-4" />}

      {!!run.summary.errors?.length && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Notes from the check ({run.summary.errors.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{run.summary.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {run.status !== 'queued' && run.status !== 'running' && run.status !== 'failed' && (
        proposals.length === 0 ? (
          <Empty title="No changes suggested">
            {run.summary.checked ? `All ${run.summary.checked} entries look current.` : 'Nothing in this run would change the library.'}
            {editable && ' Apply to mark them reviewed today.'}
            {editable && <div className="mt-3"><Button onClick={() => setConfirm(true)}>Mark reviewed</Button></div>}
          </Empty>
        ) : (
          <div className="space-y-4">
            {proposals.map((p) => <ProposalCard key={p.id} p={p} editable={editable && !busy} onDecide={(d) => decide(p, d)} />)}
          </div>
        )
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Apply {approved} change(s) to the library?</DialogTitle>
          <DialogDescription>
            Approved changes are written now and every {SCOPE_LABEL[run.scope].toLowerCase()} entry is marked reviewed today.
            {pending.length > 0 && ` ${pending.length} undecided change(s) will be skipped.`} Candidates’ matches are then recalculated;
            pinned, hidden and published choices are kept.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild><Button variant="ghost">Back</Button></DialogClose>
            <Button
              disabled={busy}
              onClick={() => act(async () => {
                const n = await api.applyLibraryRefresh(run.id)
                setDone(n)
                setConfirm(false)
                await reload()
              })}
            >
              Apply
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

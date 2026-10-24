import { Eye, EyeOff, Lock, Pin, PinOff, Plus } from 'lucide-react'
import { useState } from 'react'
import { Empty, ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { MatchBreakdown } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import type { TabProps } from './types'

const CAREER_DIMS: [keyof MatchBreakdown, string, number][] = [
  ['interest', 'Interest', 35], ['aptitude', 'Aptitude', 25], ['workstyle', 'Work style', 15], ['values', 'Values', 10], ['outlook', 'Outlook', 10], ['constraints', 'Feasible', 5],
]
const STREAM_DIMS: [keyof MatchBreakdown, string, number][] = [
  ['interest', 'Interest', 35], ['aptitude', 'Aptitude', 30], ['academics', 'Academics', 20], ['breadth', 'Breadth', 10], ['board', 'Board', 5],
]

type Row = {
  id: string; name: string; sub: string; fit: number; breakdown: MatchBreakdown; action: 'pinned' | 'hidden' | 'added' | null; visible: boolean
  extra?: React.ReactNode
}

export default function OptionsTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const streams = c.track === 'early_explorer'
  const table = streams ? 'stream_matches' : 'career_matches'
  const { data, error, loading, reload } = useAsync(async () => {
    if (streams) {
      const [m, lib] = await Promise.all([api.streamMatches(c.id), api.streams()])
      const rows: Row[] = m.map((x) => ({
        id: x.id, name: x.stream?.name ?? '—', sub: x.stream?.subjects.join(', ') ?? '', fit: x.fit_score, breakdown: x.breakdown, action: x.counsellor_action, visible: x.visible_to_candidate,
        extra: x.stream && (
          <div className="mt-1 text-xs text-muted">
            Keeps open {x.stream.keeps_open_families.length} families{x.stream.closes_families.length > 0 && ` · closes ${x.stream.closes_families.join(', ')}`}
          </div>
        ),
      }))
      return { rows, library: lib.map((s) => ({ id: s.id, name: s.name })), used: new Set(m.map((x) => x.stream_option_id)) }
    }
    const [m, lib] = await Promise.all([api.careerMatches(c.id), api.careers()])
    const rows: Row[] = m.map((x) => ({
      id: x.id, name: x.career?.name ?? '—', sub: `${x.career?.family ?? ''} · ${x.career?.riasec_code ?? ''}`, fit: x.fit_score, breakdown: x.breakdown, action: x.counsellor_action, visible: x.visible_to_candidate,
      extra: x.career && <Badge variant={x.career.outlook === 'growing' ? 'ok' : x.career.outlook === 'declining' ? 'danger' : 'outline'} className="mt-1 capitalize">{x.career.outlook}</Badge>,
    }))
    return { rows, library: lib.map((k) => ({ id: k.id, name: `${k.name} (${k.family})` })), used: new Set(m.map((x) => x.career_id)) }
  }, [c.id, streams])
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const rows = [...data!.rows].sort((a, b) => Number(b.action === 'pinned') - Number(a.action === 'pinned') || Number(a.action === 'hidden') - Number(b.action === 'hidden'))
  const published = rows.some((r) => r.visible)
  const dims = streams ? STREAM_DIMS : CAREER_DIMS

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); await reload() } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <div className="font-bold text-pine-900">{streams ? 'Stream recommendations' : 'Career matches'}</div>
            <p className="text-sm text-muted">
              {streams ? 'Always keep the widest "keep options open" combination in the list. Never present a single career on this track.' : 'Top 15 from the matcher. Pin to lift, hide to remove, or add from the library.'}
            </p>
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
            <span className="text-sm font-semibold text-pine-900">{published ? 'Published to candidate' : 'Publish to candidate'}</span>
            <Switch checked={published} disabled={busy || rows.length === 0} onCheckedChange={(on) => act(() => api.setMatchesPublished(table, c.id, on))} aria-label="Publish to candidate" />
          </label>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Empty title="No matches yet">Matching runs in the worker once the assessments are scored.</Empty>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>{streams ? 'Stream' : 'Career'}</TH>
                <TH>Fit</TH>
                <TH className="min-w-72">Breakdown</TH>
                <TH title="Counsellor only; stripped from candidate views"><span className="inline-flex items-center gap-1">Swadharma <Lock className="size-3" /></span></TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.id} className={cn(r.action === 'hidden' && 'opacity-50')}>
                  <TD className="text-sm text-muted">{i + 1}</TD>
                  <TD>
                    <div className="flex items-center gap-2 font-semibold text-pine-900">
                      {r.name}
                      {r.action === 'pinned' && <Badge variant="sand"><Pin className="size-3" /> pinned</Badge>}
                      {r.action === 'added' && <Badge variant="outline">added</Badge>}
                      {r.action === 'hidden' && <Badge variant="outline">hidden</Badge>}
                      {r.visible && <Badge variant="ok">visible</Badge>}
                    </div>
                    <div className="text-xs text-muted">{r.sub}</div>
                    {r.extra}
                  </TD>
                  <TD className="text-lg font-extrabold text-pine-900">{Number.isFinite(r.fit) && r.fit !== null ? Math.round(r.fit) : '—'}</TD>
                  <TD>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-sand-200" aria-label="Score breakdown">
                      {dims.map(([k, label, max], j) => (
                        <div key={k} title={`${label}: ${r.breakdown[k] ?? 0} / ${max}`} className={['bg-pine-700', 'bg-pine-500', 'bg-pine-300', 'bg-saffron-500', 'bg-sand-400', 'bg-sand-300'][j]} style={{ width: `${Number(r.breakdown[k] ?? 0)}%` }} />
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      {dims.map(([k, label, max]) => <span key={k}>{label} {(r.breakdown[k] as number | undefined) ?? '—'}/{max}</span>)}
                    </div>
                  </TD>
                  <TD className="text-sm font-semibold text-pine-800">{r.breakdown.swadharma ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {r.action === 'pinned' ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.setMatchAction(table, r.id, null))}><PinOff /> Unpin</Button>
                    ) : r.action !== 'hidden' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.setMatchAction(table, r.id, 'pinned'))}><Pin /> Pin</Button>
                    )}
                    {r.action === 'hidden' ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.setMatchAction(table, r.id, null))}><Eye /> Restore</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.setMatchAction(table, r.id, 'hidden'))}><EyeOff /> Hide</Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm font-semibold text-pine-900">Add from library</span>
          <Select className="max-w-md flex-1" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Choose from library">
            <option value="">Choose…</option>
            {data!.library.filter((l) => !data!.used.has(l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Button variant="secondary" disabled={!adding || busy} onClick={() => act(async () => {
            if (streams) await api.addStreamMatch(c.id, adding)
            else await api.addCareerMatch(c.id, adding)
            setAdding('')
          })}><Plus /> Add</Button>
        </CardContent>
      </Card>
    </div>
  )
}

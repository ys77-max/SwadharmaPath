import { Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { ROADMAP_KIND_LABEL, ROADMAP_TEMPLATES } from '@/lib/constants'
import type { ItemStatus, RoadmapItem, RoadmapKind, RoadmapTemplate } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { fmtDate } from '@/lib/utils'
import type { TabProps } from './types'

const STATUS_VARIANT: Record<ItemStatus, 'outline' | 'default' | 'ok' | 'danger'> = { todo: 'outline', in_progress: 'default', done: 'ok', missed: 'danger' }

function defaultTemplate(track: string, cls: string | null): RoadmapTemplate {
  if (track === 'early_explorer') return 'class8_10_exposure'
  if (track === 'professional') return 'transition'
  return /11|12/.test(cls ?? '') ? 'class11_12' : 'ug'
}

export default function RoadmapTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const { data, error, loading, reload } = useAsync(() => api.roadmap(c.id), [c.id])
  const [template, setTemplate] = useState<RoadmapTemplate>(defaultTemplate(c.track, c.class_or_years_exp))
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); await reload() } finally { setBusy(false) }
  }

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const { roadmap, items } = data!

  if (!roadmap) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Create a roadmap</CardTitle>
          <CardDescription>Start from a template, then edit the items. The candidate sees it only after you publish.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(ROADMAP_TEMPLATES) as RoadmapTemplate[]).map((t) => (
              <label key={t} className={`cursor-pointer rounded-xl border p-3 ${template === t ? 'border-pine-600 bg-pine-50' : 'border-line'}`}>
                <input type="radio" name="template" className="sr-only" checked={template === t} onChange={() => setTemplate(t)} />
                <div className="font-semibold text-pine-900">{ROADMAP_TEMPLATES[t].label}</div>
                <div className="text-xs text-muted">{ROADMAP_TEMPLATES[t].items.length} starter items · {ROADMAP_TEMPLATES[t].months} months</div>
              </label>
            ))}
          </div>
          <Field label="Start date" className="max-w-xs"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Button disabled={busy} onClick={() => act(() => api.createRoadmap(c.id, template, start))}>Create roadmap</Button>
        </CardContent>
      </Card>
    )
  }

  const save = (item: Partial<RoadmapItem> & { id?: string }) => act(() => api.saveRoadmapItem({ roadmap_id: roadmap.id, ...item }))
  const done = items.filter((i) => i.status === 'done').length

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <div className="flex items-center gap-2 font-bold text-pine-900">
              {ROADMAP_TEMPLATES[roadmap.template].label} roadmap
              <Badge variant={roadmap.status === 'published' ? 'ok' : roadmap.status === 'draft' ? 'outline' : 'sand'} className="capitalize">{roadmap.status}</Badge>
            </div>
            <div className="text-sm text-muted">{fmtDate(roadmap.start_date)} – {fmtDate(roadmap.end_date)} · {done}/{items.length} done{roadmap.published_at && ` · published ${fmtDate(roadmap.published_at)}`}</div>
          </div>
          <div className="flex gap-2">
            {roadmap.status === 'published' ? (
              <Button variant="outline" disabled={busy} onClick={() => act(() => api.setRoadmapStatus(roadmap.id, 'paused'))}>Pause</Button>
            ) : (
              <Button disabled={busy || items.length === 0} onClick={() => act(() => api.setRoadmapStatus(roadmap.id, 'published'))}><Send /> Publish to candidate</Button>
            )}
            {roadmap.status === 'published' && <Button variant="secondary" disabled={busy} onClick={() => act(() => api.setRoadmapStatus(roadmap.id, 'completed'))}>Mark completed</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <THead><TR><TH>Kind</TH><TH className="min-w-72">Title</TH><TH>Due</TH><TH>Owner</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>
            {items.map((i) => (
              <TR key={i.id}>
                <TD>
                  <Select className="w-32" value={i.kind} onChange={(e) => save({ id: i.id, kind: e.target.value as RoadmapKind })} aria-label="Kind">
                    {(Object.keys(ROADMAP_KIND_LABEL) as RoadmapKind[]).map((k) => <option key={k} value={k}>{ROADMAP_KIND_LABEL[k]}</option>)}
                  </Select>
                </TD>
                <TD>
                  <Input defaultValue={i.title} onBlur={(e) => e.target.value !== i.title && save({ id: i.id, title: e.target.value })} aria-label="Title" />
                  {i.evidence_url && <div className="mt-1 text-xs text-pine-700">Evidence uploaded</div>}
                </TD>
                <TD><Input type="date" className="w-40" defaultValue={i.due_date ?? ''} onBlur={(e) => e.target.value !== (i.due_date ?? '') && save({ id: i.id, due_date: e.target.value || null })} aria-label="Due date" /></TD>
                <TD>
                  <Select className="w-32" value={i.owner} onChange={(e) => save({ id: i.id, owner: e.target.value as RoadmapItem['owner'] })} aria-label="Owner">
                    <option value="candidate">Candidate</option><option value="parent">Parent</option><option value="counsellor">Counsellor</option>
                  </Select>
                </TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Select className="w-36" value={i.status} onChange={(e) => save({ id: i.id, status: e.target.value as ItemStatus })} aria-label="Status">
                      <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="missed">Missed</option>
                    </Select>
                    <span className={`size-2.5 rounded-full ${{ outline: 'bg-sand-300', default: 'bg-pine-400', ok: 'bg-ok', danger: 'bg-danger' }[STATUS_VARIANT[i.status]]}`} />
                  </div>
                </TD>
                <TD><Button size="icon" variant="ghost" disabled={busy} onClick={() => act(() => api.deleteRoadmapItem(i.id))} aria-label="Delete item"><Trash2 /></Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="border-t border-line p-3">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({ kind: 'task', title: 'New item', owner: 'candidate', status: 'todo' })}><Plus /> Add item</Button>
        </div>
      </Card>
    </div>
  )
}

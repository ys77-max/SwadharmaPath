import { CheckCircle2, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { api } from '@/lib/api'
import { ADAPTABILITY_LABEL, ANCHOR_LABEL, APTITUDE_LABEL, RIASEC_LABEL, WORKSTYLE_LABEL, variantFor } from '@/lib/constants'
import type { AssessmentResult, Narrative } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { fmtDate } from '@/lib/utils'
import type { TabProps } from './types'

const PINE = '#155e5d'
const SAFFRON = '#e0a458'
const SAND = '#c79a55'

function byCode(results: AssessmentResult[], instrumentIds: Record<string, string>, code: string) {
  return results.find((r) => instrumentIds[r.instrument_id] === code)
}

export default function ProfileTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const junior = c.track === 'early_explorer'
  const { data, error, loading, reload } = useAsync(async () => {
    const [results, profile, instruments] = await Promise.all([api.assessmentResults(c.id), api.profile(c.id), api.instrumentsFor(variantFor(c.track), true)])
    return { results, profile, codes: Object.fromEntries(instruments.map((i) => [i.id, i.code])) }
  }, [c.id])
  const [n, setN] = useState<Narrative>({ strengths: [], watch_outs: [], themes: [], summary: '' })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)

  useEffect(() => {
    if (data?.profile?.narrative) setN({ summary: '', ...data.profile.narrative })
  }, [data?.profile])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const { results, profile, codes } = data!
  const interest = byCode(results, codes, 'interest')
  const aptitude = byCode(results, codes, 'aptitude')
  const workstyle = byCode(results, codes, 'workstyle')
  const bigfive = byCode(results, codes, 'bigfive')
  const values = byCode(results, codes, 'values') ?? byCode(results, codes, 'school_values')
  const anchors = byCode(results, codes, 'career_anchors')
  const adaptability = byCode(results, codes, 'adaptability')

  const update = (patch: Partial<Narrative>) => { setN((x) => ({ ...x, ...patch })); setDirty(true) }
  const save = async () => {
    setSaving(true)
    try { await api.saveNarrative(c.id, n); setDirty(false); await reload() } finally { setSaving(false) }
  }

  const graphs = (workstyle?.derived.graphs ?? {}) as Record<string, number[]>
  const wsData = ['R', 'A', 'P', 'D'].map((f, i) => ({ factor: WORKSTYLE_LABEL[f], ...Object.fromEntries(Object.entries(graphs).map(([g, v]) => [g, v[i]])) }))
  const bands = (aptitude?.derived.bands ?? {}) as Record<string, string>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div>
          {profile?.approved_at ? (
            <span className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="size-5" /> Approved {fmtDate(profile.approved_at)}; the candidate can see their interpreted profile.</span>
          ) : (
            <span className="font-semibold text-pine-900">Not yet approved. The candidate and parent cannot see results until you approve.</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save narrative'}</Button>
          {!profile?.approved_at && <Button onClick={() => setApproveOpen(true)} disabled={results.length === 0}>Approve profile</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Interests (RIASEC)</CardTitle>
            <CardDescription>{interest ? <>Code <strong className="text-pine-900">{String(interest.derived.code)}</strong> · percentiles by age band</> : 'Not scored yet'}</CardDescription>
          </CardHeader>
          <CardContent className="h-60">
            {interest && (
              <ResponsiveContainer>
                <BarChart data={Object.entries(interest.percentiles).map(([k, v]) => ({ scale: RIASEC_LABEL[k] ?? k, pct: v }))}>
                  <CartesianGrid vertical={false} stroke="#eee" />
                  <XAxis dataKey="scale" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar isAnimationActive={false} dataKey="pct" name="Percentile" fill={PINE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aptitude</CardTitle>
            <CardDescription>Low &lt;25 · Average 25–74 · High 75–89 · Very High ≥90</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!aptitude && <p className="text-sm text-muted">Not scored yet</p>}
            {aptitude && Object.entries(aptitude.percentiles).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{APTITUDE_LABEL[k] ?? k}</span><span><Badge variant={v >= 75 ? 'ok' : v < 25 ? 'warn' : 'default'}>{bands[k]}</Badge> <span className="ml-1 text-muted">{v}th</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-sand-200"><div className="h-2 rounded-full bg-pine-600" style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work style (R-A-P-D)</CardTitle>
            <CardDescription>
              {workstyle ? <>Primary <strong className="text-pine-900">{WORKSTYLE_LABEL[String(workstyle.derived.primary)]}</strong>, secondary <strong className="text-pine-900">{WORKSTYLE_LABEL[String(workstyle.derived.secondary)]}</strong></> : 'Not scored yet'}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-60">
            {workstyle && (
              <ResponsiveContainer>
                <LineChart data={wsData}>
                  <CartesianGrid stroke="#eee" />
                  <XAxis dataKey="factor" tick={{ fontSize: 12 }} />
                  <YAxis domain={[-19, 19]} ticks={[-19, -10, 0, 10, 19]} tick={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#999" strokeDasharray="4 4" />
                  <Tooltip />
                  <Legend />
                  {'others' in graphs && <Line isAnimationActive={false} dataKey="others" name="With others" stroke={PINE} strokeWidth={2} />}
                  {'stress' in graphs && <Line isAnimationActive={false} dataKey="stress" name="Under stress" stroke={SAFFRON} strokeWidth={2} />}
                  {'self' in graphs && <Line isAnimationActive={false} dataKey="self" name="Self" stroke={SAND} strokeWidth={2} strokeDasharray="5 3" />}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
          {workstyle?.derived.patterns != null && (
            <CardContent className="flex flex-wrap gap-1">
              {Object.entries(workstyle.derived.patterns as Record<string, unknown>).filter(([, v]) => v && v !== 'normal').map(([k, v]) => (
                <Badge key={k} variant="sand">{k.replace('_', ' ')}{Array.isArray(v) ? `: ${v.join(', ')}` : typeof v === 'string' ? `: ${v}` : ''}</Badge>
              ))}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{bigfive ? 'Big Five and values' : 'Values'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {bigfive && (
              <div className="grid grid-cols-5 gap-2 text-center">
                {Object.entries(bigfive.percentiles).map(([k, v]) => (
                  <div key={k}>
                    <div className="mx-auto flex h-24 w-8 items-end rounded bg-sand-200"><div className="w-full rounded bg-pine-500" style={{ height: `${v}%` }} /></div>
                    <div className="mt-1 text-xs font-bold">{({ O: 'Open', C: 'Consc.', E: 'Extra.', A: 'Agree.', N: 'Neuro.' } as Record<string, string>)[k] ?? k}</div>
                    <div className="text-xs text-muted">{v}</div>
                  </div>
                ))}
              </div>
            )}
            {values ? (
              <ol className="space-y-1">
                {((values.derived.top5 as string[]) ?? []).map((v, i) => (
                  <li key={v} className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full bg-pine-100 text-xs font-bold text-pine-800">{i + 1}</span>{v}</li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">Values not scored yet</p>}
          </CardContent>
        </Card>
        {(anchors || adaptability) && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Career anchors and readiness for change</CardTitle>
              <CardDescription>Mean agreement from 1 to 5. Anchors are what the person will not give up; readiness is how prepared they are to manage a move.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <ScaleBars title="Career anchors" result={anchors} labels={ANCHOR_LABEL} />
              <ScaleBars title="Readiness for change" result={adaptability} labels={ADAPTABILITY_LABEL} />
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Narrative</CardTitle>
          <CardDescription>Plain language, written to the {junior ? 'student (leanings, not types)' : 'candidate'}. This is what they see after approval.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-3">
          <ListEditor label="Strengths" items={n.strengths} onChange={(strengths) => update({ strengths })} />
          <ListEditor label="Watch-outs" items={n.watch_outs} onChange={(watch_outs) => update({ watch_outs })} />
          <ListEditor label="Themes" items={n.themes} onChange={(themes) => update({ themes })} />
          <div className="md:col-span-3">
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" value={n.summary ?? ''} onChange={(e) => update({ summary: e.target.value })} rows={4} />
          </div>
        </CardContent>
      </Card>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogTitle>Approve and share the profile?</DialogTitle>
          <DialogDescription>The candidate{c.parent_user_id ? ' and parent' : ''} will see the interpreted profile and narrative. Raw scores and validity flags stay with you.</DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={async () => { if (dirty) await api.saveNarrative(c.id, n); await api.approveProfile(c.id); setApproveOpen(false); setDirty(false); reload() }}>Approve</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft('') } }
  return (
    <div>
      <Label>{label}</Label>
      <ul className="mb-2 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-1 rounded-lg bg-sand-100 px-2 py-1.5 text-sm">
            <Input value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className="h-auto border-0 bg-transparent p-0 focus:ring-0" aria-label={`${label} ${i + 1}`} />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-0.5 text-muted hover:text-danger" aria-label="Remove"><X className="size-4" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder={`Add ${label.toLowerCase()}`} />
        <Button size="icon" variant="secondary" onClick={add} aria-label={`Add ${label}`}><Plus /></Button>
      </div>
    </div>
  )
}

function ScaleBars({ title, result, labels }: { title: string; result: AssessmentResult | undefined; labels: Record<string, string> }) {
  if (!result) return <div><div className="text-sm font-semibold">{title}</div><p className="text-sm text-muted">Not scored yet</p></div>
  const raw = result.raw as Record<string, number>
  const order = ((result.derived.order as string[]) ?? Object.keys(raw))
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      {order.map((k) => (
        <div key={k}>
          <div className="flex justify-between text-sm"><span>{labels[k] ?? k}</span><span className="text-muted">{raw[k]?.toFixed(1)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-sand-200"><div className="h-2 rounded-full bg-pine-600" style={{ width: `${((raw[k] ?? 1) - 1) * 25}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

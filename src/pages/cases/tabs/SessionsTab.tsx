import { CalendarPlus, Check, FileText, Lock, Plus, Trash2, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { api } from '@/lib/api'
import { ICCC, ICCC_ORDER } from '@/lib/constants'
import type { CounsellingSession, IcccStage } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { cn, fmtDateTime } from '@/lib/utils'
import type { TabProps } from './types'

type Draft = Partial<CounsellingSession> & { candidate_id: string }

function toLocalInput(isoStr?: string) {
  const d = isoStr ? new Date(isoStr) : new Date(Date.now() + 2 * 86_400_000)
  if (!isoStr) d.setHours(17, 0, 0, 0)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

export default function SessionsTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const { data, error, loading, reload } = useAsync(() => api.sessions(c.id), [c.id])
  const [selected, setSelected] = useState<string | 'new' | null>(null)

  useEffect(() => {
    if (data && selected === null) setSelected(data[0]?.id ?? 'new')
  }, [data, selected])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const sessions = data!
  const current = selected === 'new' ? null : sessions.find((s) => s.id === selected) ?? null
  const lastStage = sessions.find((s) => new Date(s.scheduled_at) <= new Date())?.iccc_stage

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-2">
        <Button className="w-full" onClick={() => setSelected('new')} variant={selected === 'new' ? 'default' : 'outline'}><CalendarPlus /> Schedule session</Button>
        {sessions.map((s) => {
          const past = new Date(s.scheduled_at) <= new Date()
          return (
            <button key={s.id} onClick={() => setSelected(s.id)} className={cn('w-full rounded-xl border p-3 text-left transition-colors', selected === s.id ? 'border-pine-600 bg-pine-50' : 'border-line bg-white hover:bg-sand-50')}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-pine-900">{fmtDateTime(s.scheduled_at)}</span>
                {past ? (s.attended ? <Badge variant="ok">Attended</Badge> : s.attended === false ? <Badge variant="danger">No-show</Badge> : <Badge variant="warn">Update</Badge>) : <Badge>Upcoming</Badge>}
              </div>
              <div className="mt-0.5 text-sm text-muted">{ICCC[s.iccc_stage].label} · <span className="capitalize">{s.mode.replace('_', ' ')}</span></div>
            </button>
          )
        })}
      </div>
      <SessionEditor
        key={selected ?? 'none'}
        initial={current ?? { candidate_id: c.id, iccc_stage: nextStage(lastStage), mode: 'video', duration_min: 60, action_items: [] }}
        onSaved={async (s) => { await reload(); setSelected(s.id) }}
      />
    </div>
  )
}

function nextStage(last?: IcccStage): IcccStage {
  if (!last) return 'know_self'
  const i = ICCC_ORDER.indexOf(last)
  return ICCC_ORDER[Math.min(i + 1, ICCC_ORDER.length - 1)]
}

function SessionEditor({ initial, onSaved }: { initial: Draft; onSaved: (s: CounsellingSession) => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [when, setWhen] = useState(toLocalInput(initial.scheduled_at))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setSaved(false) }
  const isNew = !d.id
  const past = d.scheduled_at ? new Date(d.scheduled_at) <= new Date() : false
  const items = d.action_items ?? []

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      const s = await api.saveSession({ ...d, scheduled_at: new Date(when).toISOString() })
      setSaved(true)
      onSaved(s)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{isNew ? 'New session' : `Session · ${ICCC[d.iccc_stage ?? 'know_self'].label}`}</CardTitle>
        {d.meeting_url && <Button asChild size="sm" variant="secondary"><a href={d.meeting_url} target="_blank" rel="noreferrer"><Video /> Join</a></Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date and time" className="sm:col-span-2"><Input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setSaved(false) }} /></Field>
          <Field label="Duration (min)"><Input type="number" min={15} step={15} value={d.duration_min ?? 60} onChange={(e) => set({ duration_min: Number(e.target.value) })} /></Field>
          <Field label="Mode">
            <Select value={d.mode} onChange={(e) => set({ mode: e.target.value as CounsellingSession['mode'] })}>
              <option value="video">Video</option><option value="in_person">In person</option><option value="phone">Phone</option>
            </Select>
          </Field>
          <Field label="Meeting URL" className="sm:col-span-2"><Input type="url" placeholder="https://" value={d.meeting_url ?? ''} onChange={(e) => set({ meeting_url: e.target.value || null })} /></Field>
          <Field label="ICCC stage" className="sm:col-span-2">
            <Select value={d.iccc_stage} onChange={(e) => set({ iccc_stage: e.target.value as IcccStage })}>
              {ICCC_ORDER.map((s, i) => <option key={s} value={s}>{i + 1}. {ICCC[s].label}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-pine-900"><Lock className="size-3.5" /> Private notes (counsellor only)</span>
            <Button size="sm" variant="ghost" onClick={() => set({ notes_private: [d.notes_private, ICCC[d.iccc_stage ?? 'know_self'].template].filter(Boolean).join('\n\n') })}>
              <FileText /> Insert {ICCC[d.iccc_stage ?? 'know_self'].short} template
            </Button>
          </div>
          <Textarea rows={9} value={d.notes_private ?? ''} onChange={(e) => set({ notes_private: e.target.value })} className="font-mono text-sm" />
        </div>

        <Field label="Summary for candidate" hint="Shown to the candidate (and parent) in their Sessions page.">
          <Textarea rows={3} value={d.summary_for_candidate ?? ''} onChange={(e) => set({ summary_for_candidate: e.target.value })} />
        </Field>

        <div>
          <div className="mb-2 text-sm font-semibold text-pine-900">Action items</div>
          <ul className="space-y-2">
            {items.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-pine-700" checked={!!a.done} onChange={(e) => set({ action_items: items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} aria-label="Done" />
                <Input value={a.text} onChange={(e) => set({ action_items: items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <Select className="w-36" value={a.owner} onChange={(e) => set({ action_items: items.map((x, j) => (j === i ? { ...x, owner: e.target.value as typeof a.owner } : x)) })} aria-label="Owner">
                  <option value="candidate">Candidate</option><option value="parent">Parent</option><option value="counsellor">Counsellor</option>
                </Select>
                <Button size="icon" variant="ghost" onClick={() => set({ action_items: items.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 /></Button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => set({ action_items: [...items, { text: '', owner: 'candidate' }] })}><Plus /> Add action item</Button>
        </div>

        {past && (
          <fieldset className="flex items-center gap-4 text-sm">
            <legend className="sr-only">Attendance</legend>
            <span className="font-semibold text-pine-900">Attendance</span>
            {[{ v: true, l: 'Attended' }, { v: false, l: 'No-show' }].map((o) => (
              <label key={o.l} className="flex items-center gap-1.5"><input type="radio" name="attended" className="accent-pine-700" checked={d.attended === o.v} onChange={() => set({ attended: o.v })} /> {o.l}</label>
            ))}
          </fieldset>
        )}

        {err && <ErrorBox error={err} />}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="flex items-center gap-1 text-sm font-semibold text-ok"><Check className="size-4" /> Saved</span>}
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Schedule' : 'Save session'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

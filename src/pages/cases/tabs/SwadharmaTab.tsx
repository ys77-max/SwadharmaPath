import { Check, Lock, Pencil, Send, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Empty, ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { DISCLAIMER, SWADHARMA_COMPONENTS } from '@/lib/constants'
import type { SwadharmaScore } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { cn, fmtDate, fmtDateTime } from '@/lib/utils'
import type { TabProps } from './types'

const CERTAINTY: Record<string, string> = { exact: 'Exact', approx_15m: '± 15 min', approx_1h: '± 1 hour', unknown: 'Unknown' }
const VERDICT_STYLE = { Agree: 'ok', Partial: 'warn', Conflict: 'danger' } as const

export default function SwadharmaTab({ bundle }: TabProps) {
  const c = bundle.candidate
  const junior = c.track === 'early_explorer'
  const { data, error, loading, reload } = useAsync(() => api.swadharma(c.id), [c.id])
  const [releaseOpen, setReleaseOpen] = useState(false)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const { optedIn, birth, chart, scores, releases, swadharmaReports } = data!

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-pine-800 bg-pine-900 p-4 text-sand-100">
        <Lock className="mt-0.5 size-5 shrink-0 text-saffron-400" />
        <div className="text-sm">
          <p className="font-bold text-white">Counsellor only</p>
          <p>
            Nothing on this tab reaches the candidate or parent. The database has no candidate or parent policy on these tables; the only way out is a
            separate Swadharma Report that you release below. Use it as a lens for reflection, never to rule out a career.
          </p>
        </div>
      </div>

      {!optedIn || !birth?.consent_at ? (
        <Empty title="No Swadharma consent" icon={<ShieldAlert className="size-5" />}>
          The candidate has not opted in or consent was not recorded at onboarding. The worker only computes a chart when both exist.
        </Empty>
      ) : !chart ? (
        <Empty title="Chart not computed yet">Consent recorded {fmtDate(birth.consent_at)} ({birth.consent_text_version}). The worker computes the chart on its next run.</Empty>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Chart summary</CardTitle>
                <CardDescription>{chart.ayanamsa} sidereal · whole-sign (Parashari) · Placidus (KP) · {chart.engine_version} · computed {fmtDate(chart.computed_at)}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  <Fact k="Lagna" v={chart.d1?.lagna} sub={chart.d1?.lagna_lord && `lord ${chart.d1.lagna_lord}`} />
                  <Fact k="Moon sign" v={chart.d1?.moon_sign} sub={chart.d1?.nakshatra} />
                  <Fact k="Sun sign" v={chart.d1?.sun_sign} />
                  <Fact k="D10 lagna" v={chart.d10?.lagna} sub={chart.d10?.tenth_lord && `10th lord ${chart.d10.tenth_lord}`} />
                  <Fact k="KP 10th sub-lord" v={chart.kp_cusps?.tenth_sub_lord} sub={chart.kp_cusps?.tenth_star_lord && `star-lord ${chart.kp_cusps.tenth_star_lord}`} />
                  <Fact k="Current dasha" v={chart.dashas?.current && `${chart.dashas.current.maha} / ${chart.dashas.current.antar}`} sub={chart.dashas?.current && `until ${fmtDate(chart.dashas.current.until)}`} />
                  <Fact k="Birth time" v={birth.birth_time ?? 'Not known'} sub={CERTAINTY[birth.time_certainty]} />
                  <Fact k="Birth place" v={birth.birth_place} />
                  <Fact k="Consent" v={fmtDate(birth.consent_at)} sub={birth.consent_text_version ?? undefined} />
                </dl>
                {birth.time_certainty === 'unknown' && (
                  <p className="mt-4 rounded-lg bg-saffron-400/20 p-3 text-sm text-pine-900">Birth time unknown: only Moon-sign and dignity components were run, and every family is marked low confidence.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Personality lens</CardTitle>
                <CardDescription>{junior ? 'Phrased for parents of a 13–15-year-old' : 'From lagna, Moon, Sun and lagna lord'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <LensList title="Tendencies" items={chart.insights?.personality_lens?.tendencies} />
                <LensList title="Strengths" items={chart.insights?.personality_lens?.strengths} />
                <LensList title="Watch-outs" items={chart.insights?.personality_lens?.watch_outs} />
              </CardContent>
            </Card>
          </div>

          <FamilyTable scores={scores} onSaved={reload} />

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Agreement with psychometric top 5</CardTitle>
                <CardDescription>Where the two lenses agree, partly agree, or conflict.</CardDescription>
              </CardHeader>
              <CardContent>
                {!chart.insights?.agreement?.length ? <p className="text-sm text-muted">Available after career matching has run.</p> : (
                  <Table>
                    <THead><TR><TH>Family</TH><TH>Swadharma</TH><TH>Psychometric</TH><TH>Verdict</TH></TR></THead>
                    <TBody>
                      {chart.insights.agreement.map((a) => (
                        <TR key={a.family}>
                          <TD className="text-sm font-semibold">{a.family}</TD>
                          <TD className="text-sm">#{a.swadharma_rank}</TD>
                          <TD className="text-sm">{a.psychometric_rank ? `#${a.psychometric_rank}` : '—'}</TD>
                          <TD><Badge variant={VERDICT_STYLE[a.verdict]}>{a.verdict}</Badge></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Favourable windows</CardTitle>
                <CardDescription>{junior ? 'Limited to board-exam years and Class 11 entry' : 'From Vimshottari dasha over the next 10 years'}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {scores.flatMap((s) => (s.favourable_windows ?? []).map((w) => ({ ...w, family: s.career_family })))
                    .sort((a, b) => a.from.localeCompare(b.from))
                    .filter((w, i, arr) => arr.findIndex((x) => x.from === w.from && x.purpose === w.purpose) === i)
                    .slice(0, 8)
                    .map((w) => (
                      <li key={w.from + w.purpose} className="flex justify-between gap-3 rounded-lg border border-line px-3 py-2">
                        <span className="font-semibold text-pine-900">{w.purpose}</span>
                        <span className="whitespace-nowrap text-muted">{fmtDate(w.from, { month: 'short', year: 'numeric' })} – {fmtDate(w.to, { month: 'short', year: 'numeric' })}</span>
                      </li>
                    ))}
                  {scores.every((s) => !s.favourable_windows?.length) && <li className="text-muted">No windows computed.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Release Swadharma Report</CardTitle>
            <CardDescription>Releasing is logged and cannot be undone. The report carries the full disclaimer on page 1.</CardDescription>
          </div>
          <Button variant="accent" onClick={() => setReleaseOpen(true)} disabled={!optedIn || swadharmaReports.length === 0}>
            <Send /> Release Swadharma Report
          </Button>
        </CardHeader>
        <CardContent>
          {swadharmaReports.length === 0 && <p className="mb-3 text-sm text-muted">Generate a Swadharma report on the Reports tab first.</p>}
          {releases.length === 0 ? (
            <p className="text-sm text-muted">Not released to anyone.</p>
          ) : (
            <ul className="space-y-2">
              {releases.map((r) => (
                <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="lock">Released to {r.released_to}</Badge>
                    <span className="text-muted">{fmtDateTime(r.released_at)} · report v{swadharmaReports.find((x) => x.id === r.report_id)?.version ?? '?'}</span>
                  </div>
                  <p className="mt-1 text-pine-900">“{r.reason}”</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ReleaseDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        candidateId={c.id}
        hasParent={Boolean(c.parent_user_id)}
        reports={swadharmaReports.map((r) => ({ id: r.id, label: `Version ${r.version} · ${fmtDate(r.created_at)}${r.pdf_path ? '' : ' (still rendering)'}` }))}
        onDone={() => { setReleaseOpen(false); reload() }}
      />
    </div>
  )
}

function FamilyTable({ scores, onSaved }: { scores: SwadharmaScore[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const comps = Object.entries(SWADHARMA_COMPONENTS)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Career-family points</CardTitle>
        <CardDescription>15 families, max 100 each. Components: {comps.map(([, v]) => `${v.label} ${v.max}`).join(' · ')}</CardDescription>
      </CardHeader>
      <Table>
        <THead>
          <TR>
            <TH>Family</TH>
            <TH className="w-40">Points</TH>
            {comps.map(([k, v]) => <TH key={k} className="text-center" title={v.label}>{k === 'ashtakavarga' ? 'AV' : k.toUpperCase()}</TH>)}
            <TH>Confidence</TH>
            <TH>Counsellor notes</TH>
          </TR>
        </THead>
        <TBody>
          {scores.map((s, i) => (
            <TR key={s.id}>
              <TD className="font-semibold text-pine-900"><span className="mr-2 text-xs text-muted">{i + 1}</span>{s.career_family}</TD>
              <TD>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-sand-200"><div className={cn('h-2 rounded-full', i < 3 ? 'bg-saffron-500' : 'bg-pine-500')} style={{ width: `${(s.points / s.max_points) * 100}%` }} /></div>
                  <span className="w-8 text-right text-sm font-bold">{Math.round(s.points)}</span>
                </div>
              </TD>
              {comps.map(([k, v]) => (
                <TD key={k} className="text-center text-sm tabular-nums text-muted" title={`${v.label}: ${s.components[k] ?? 0} / ${v.max}`}>{s.components[k] ?? '—'}</TD>
              ))}
              <TD><Badge variant={s.confidence === 'high' ? 'ok' : s.confidence === 'low' ? 'warn' : 'default'}>{s.confidence}</Badge></TD>
              <TD className="min-w-56">
                {editing === s.id ? (
                  <div className="flex gap-1">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="min-h-0 text-sm" autoFocus />
                    <Button size="icon" onClick={async () => { await api.saveSwadharmaNote(s.id, note); setEditing(null); onSaved() }} aria-label="Save note"><Check /></Button>
                  </div>
                ) : (
                  <button className="group flex w-full items-start gap-1 text-left text-sm" onClick={() => { setEditing(s.id); setNote(s.counsellor_notes ?? '') }}>
                    <span className={s.counsellor_notes ? 'text-pine-900' : 'text-muted'}>{s.counsellor_notes || 'Add note'}</span>
                    <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
                  </button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}

function ReleaseDialog({ open, onOpenChange, candidateId, hasParent, reports, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; candidateId: string; hasParent: boolean
  reports: { id: string; label: string }[]; onDone: () => void
}) {
  const [reportId, setReportId] = useState('')
  const [to, setTo] = useState<'candidate' | 'parent' | 'both'>('candidate')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const rid = reportId || reports[0]?.id || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Release the Swadharma Report</DialogTitle>
        <DialogDescription>This is permanent. The release, its reason and your name are written to the audit log.</DialogDescription>
        <div className="mt-5 space-y-4">
          <Field label="Report version">
            <Select value={rid} onChange={(e) => setReportId(e.target.value)}>
              {reports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-pine-900">Release to</legend>
            <div className="flex gap-2">
              {(['candidate', 'parent', 'both'] as const).map((v) => (
                <label key={v} className={cn('flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold capitalize', to === v ? 'border-pine-600 bg-pine-50 text-pine-900' : 'border-line text-muted', (v !== 'candidate' && !hasParent) && 'pointer-events-none opacity-40')}>
                  <input type="radio" name="release-to" value={v} className="sr-only" checked={to === v} onChange={() => setTo(v)} disabled={v !== 'candidate' && !hasParent} />
                  {v}
                </label>
              ))}
            </div>
            {!hasParent && <p className="mt-1 text-xs text-muted">No parent linked to this case.</p>}
          </fieldset>
          <Field label="Reason (required)" hint="Why now, and what was discussed with the family.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <p className="rounded-lg bg-sand-100 p-3 text-xs text-pine-900">{DISCLAIMER}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-pine-700" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this release cannot be undone and the report will be visible to the {to === 'both' ? 'candidate and parent' : to}.
          </label>
          {err && <ErrorBox error={err} />}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" disabled={!rid || !reason.trim() || !ack || busy} onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await api.releaseSwadharma({ candidateId, reportId: rid, to, reason: reason.trim() })
              setReason('')
              setAck(false)
              onDone()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Releasing…' : 'Release permanently'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Fact({ k, v, sub }: { k: string; v?: string | null; sub?: string | null | false }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted">{k}</dt>
      <dd className="font-semibold text-pine-900">{v || '—'}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  )
}

function LensList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-muted">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-pine-900">{(items ?? ['—']).map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  )
}

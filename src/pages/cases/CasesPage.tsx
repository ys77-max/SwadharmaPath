import { AlertTriangle, CalendarClock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { api } from '@/lib/api'
import { ICCC, ICCC_ORDER, TRACK_LABEL } from '@/lib/constants'
import type { CaseloadRow, Track } from '@/lib/types'
import { useAsync } from '@/lib/useAsync'
import { cn, daysUntil, fmtDateTime } from '@/lib/utils'

export function riskFlags(r: CaseloadRow): string[] {
  const f: string[] = []
  if (r.consent_pending) f.push('Guardian consent pending')
  if (r.validity_issues > 0) f.push(`${r.validity_issues} validity flag${r.validity_issues > 1 ? 's' : ''}`)
  if (r.missed_items > 0) f.push(`${r.missed_items} missed roadmap item${r.missed_items > 1 ? 's' : ''}`)
  const sla = daysUntil(r.report_due_at)
  if (!r.reported_at && sla !== null && sla < 0) f.push('Report overdue')
  return f
}

export function nextAction(r: CaseloadRow): string {
  if (r.consent_pending) return 'Get guardian consent'
  if (r.assessments_done === 0) return 'Nudge to start assessments'
  if (!r.profile_approved_at) return 'Review and approve profile'
  if (r.assessed_at && !r.reported_at) return 'Generate candidate report'
  if (!r.next_session_at) return 'Schedule next session'
  return `Prepare for session ${fmtDateTime(r.next_session_at)}`
}

export function StageTrack({ stage }: { stage: CaseloadRow['iccc_stage'] }) {
  const idx = ICCC_ORDER.indexOf(stage)
  return (
    <div className="min-w-32">
      <div className="text-sm font-semibold text-pine-900">{ICCC[stage].short}</div>
      <div className="mt-1 flex gap-0.5" aria-label={`Stage ${idx + 1} of 6`}>
        {ICCC_ORDER.map((s, i) => (
          <span key={s} className={cn('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-pine-600' : 'bg-sand-300')} />
        ))}
      </div>
    </div>
  )
}

function SlaCell({ r }: { r: CaseloadRow }) {
  if (r.reported_at) return <Badge variant="ok">Delivered</Badge>
  const d = daysUntil(r.report_due_at)
  if (d === null) return <span className="text-sm text-muted">Not started</span>
  if (d < 0) return <Badge variant="danger">{-d}d overdue</Badge>
  return <Badge variant={d <= 2 ? 'warn' : 'default'}>Due in {d}d</Badge>
}

const TRACK_SHORT: Record<Track, string> = { early_explorer: 'Early explorer', student: 'Student', professional: 'Professional' }

export default function CasesPage() {
  const { data, error, loading } = useAsync(() => api.caseload(), [])
  const [q, setQ] = useState('')
  const [track, setTrack] = useState<Track | ''>('')
  const [riskOnly, setRiskOnly] = useState(false)

  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (r) =>
          (!q || (r.full_name ?? '').toLowerCase().includes(q.toLowerCase())) &&
          (!track || r.track === track) &&
          (!riskOnly || riskFlags(r).length > 0),
      ),
    [data, q, track, riskOnly],
  )

  const atRisk = (data ?? []).filter((r) => riskFlags(r).length > 0).length
  const thisWeek = (data ?? []).filter((r) => {
    const d = daysUntil(r.next_session_at)
    return d !== null && d >= 0 && d <= 7
  }).length

  return (
    <div>
      <PageHeader title="Cases" subtitle="Your caseload, ordered by next session." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Active cases" value={data?.length ?? '—'} />
        <Stat label="Sessions in the next 7 days" value={thisWeek} icon={<CalendarClock className="size-5 text-pine-600" />} />
        <Stat label="Need attention" value={atRisk} icon={<AlertTriangle className="size-5 text-saffron-600" />} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder="Search by name" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
          </div>
          <Select className="w-48" value={track} onChange={(e) => setTrack(e.target.value as Track | '')} aria-label="Filter by track">
            <option value="">All tracks</option>
            {(Object.keys(TRACK_LABEL) as Track[]).map((t) => (
              <option key={t} value={t}>{TRACK_SHORT[t]}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm font-semibold text-pine-900">
            <input type="checkbox" className="size-4 accent-pine-700" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
            Needs attention only
          </label>
        </div>
        {loading && !data ? (
          <Loading className="px-4" />
        ) : error ? (
          <ErrorBox error={error} className="m-4" />
        ) : rows.length === 0 ? (
          <div className="p-4"><Empty title="No cases match">Try clearing the filters.</Empty></div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Track</TH>
                <TH>Stage (ICCC)</TH>
                <TH>Risk</TH>
                <TH>Next action</TH>
                <TH>Report SLA</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const flags = riskFlags(r)
                return (
                  <TR key={r.candidate_id} className="hover:bg-sand-50">
                    <TD>
                      <Link to={`/cases/${r.candidate_id}`} className="font-bold text-pine-800 hover:underline">{r.full_name ?? 'Unnamed'}</Link>
                      <div className="text-xs text-muted">{[r.class_or_years_exp, r.city].filter(Boolean).join(' · ')}</div>
                    </TD>
                    <TD><Badge variant={r.track === 'early_explorer' ? 'sand' : 'default'}>{TRACK_SHORT[r.track]}</Badge></TD>
                    <TD><StageTrack stage={r.iccc_stage} /></TD>
                    <TD>
                      {flags.length === 0 ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {flags.map((f) => <Badge key={f} variant="warn"><AlertTriangle className="size-3" />{f}</Badge>)}
                        </div>
                      )}
                    </TD>
                    <TD className="text-sm">{nextAction(r)}</TD>
                    <TD><SlaCell r={r} /></TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon?: React.ReactNode }) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <div className="text-sm text-muted">{label}</div>
        <div className="text-2xl font-extrabold text-pine-900">{value}</div>
      </div>
      {icon}
    </Card>
  )
}

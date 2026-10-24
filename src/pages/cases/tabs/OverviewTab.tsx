import { CalendarClock, CheckCircle2, Circle, ShieldCheck } from 'lucide-react'
import { Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { ICCC } from '@/lib/constants'
import { useAsync } from '@/lib/useAsync'
import { ageFrom, fmtDate, fmtDateTime } from '@/lib/utils'
import type { TabProps } from './types'

export default function OverviewTab({ bundle, onGo }: TabProps & { onGo: (tab: string) => void }) {
  const { candidate: c, user, parent } = bundle
  const variant = c.track === 'early_explorer' ? 'junior' : 'standard'
  const { data, loading } = useAsync(async () => {
    const [instruments, sessions, profile, sess, roadmap, matches] = await Promise.all([
      api.instrumentsFor(variant),
      api.assessmentSessions(c.id),
      api.profile(c.id),
      api.sessions(c.id),
      api.roadmap(c.id),
      c.track === 'early_explorer' ? api.streamMatches(c.id) : api.careerMatches(c.id),
    ])
    return { instruments, sessions, profile, sess, roadmap, matches }
  }, [c.id])

  const age = ageFrom(c.dob)
  const minor = age === null || age < 18

  if (loading && !data) return <Loading />
  const done = new Set(data!.sessions.filter((s) => s.status === 'completed').map((s) => s.instrument_id))
  const upcoming = data!.sess.filter((s) => new Date(s.scheduled_at) > new Date()).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]
  const steps = [
    { label: 'Onboarding and consent', ok: Boolean(c.disclaimer_accepted_at && (!minor || c.guardian_consent_at)), tab: 'overview' },
    { label: `Assessments (${done.size}/${data!.instruments.length})`, ok: done.size >= data!.instruments.length && data!.instruments.length > 0, tab: 'assessments' },
    { label: 'Profile approved', ok: Boolean(data!.profile?.approved_at), tab: 'profile' },
    { label: c.track === 'early_explorer' ? 'Streams published' : 'Options published', ok: data!.matches.some((m) => m.visible_to_candidate), tab: 'options' },
    { label: 'Roadmap published', ok: data!.roadmap.roadmap?.status === 'published', tab: 'roadmap' },
  ]

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
                <span className="flex items-center gap-2 font-semibold text-pine-900">
                  {s.ok ? <CheckCircle2 className="size-5 text-ok" /> : <Circle className="size-5 text-sand-400" />}
                  {s.label}
                </span>
                <Button size="sm" variant="ghost" onClick={() => onGo(s.tab)}>Open</Button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-pine-600" /> Next session</CardTitle></CardHeader>
        <CardContent>
          {upcoming ? (
            <div className="space-y-1">
              <div className="text-lg font-bold text-pine-900">{fmtDateTime(upcoming.scheduled_at)}</div>
              <div className="text-sm text-muted capitalize">{upcoming.mode.replace('_', ' ')} · {upcoming.duration_min} min · {ICCC[upcoming.iccc_stage].label}</div>
              {upcoming.meeting_url && <a className="text-sm font-semibold text-pine-700 underline" href={upcoming.meeting_url} target="_blank" rel="noreferrer">Meeting link</a>}
            </div>
          ) : (
            <div className="text-sm text-muted">Nothing scheduled. <button className="font-semibold text-pine-700 underline" onClick={() => onGo('sessions')}>Schedule one</button></div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Candidate</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item k="Date of birth" v={c.dob ? `${fmtDate(c.dob)} (${age} yrs)` : 'Not given'} />
            <Item k="Board" v={c.board} />
            <Item k={c.track === 'professional' ? 'Employer' : 'School / college'} v={c.school_or_employer} />
            <Item k={c.track === 'professional' ? 'Experience' : 'Class'} v={c.class_or_years_exp} />
            <Item k={c.track === 'professional' ? 'Function' : 'Stream'} v={c.stream_or_function} />
            <Item k="City" v={c.city} />
            <Item k="Phone" v={user?.phone} />
            <Item k="Email" v={user?.email} />
            {Object.keys(c.academics ?? {}).length > 0 && <Item k="Academics" v={Object.entries(c.academics).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')} />}
            {Object.keys(c.constraints ?? {}).length > 0 && <Item k="Constraints" v={Object.entries(c.constraints).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')} />}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-pine-600" /> Consent</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row k="Disclaimer acknowledged" v={c.disclaimer_accepted_at ? fmtDate(c.disclaimer_accepted_at) : null} />
          {minor && <Row k="Guardian consent" v={c.guardian_consent_at ? fmtDate(c.guardian_consent_at) : null} />}
          <Row k="Swadharma opt-in" v={c.swadharma_opted_in ? 'Opted in' : null} neutral />
          <div className="border-t border-line pt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">Parent / guardian</div>
            <div className="mt-1 font-semibold text-pine-900">{parent?.full_name ?? 'Not linked'}</div>
            {parent?.phone && <div className="text-muted">{parent.phone}</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Item({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 text-pine-900">{v || '—'}</dd>
    </div>
  )
}

function Row({ k, v, neutral }: { k: string; v: string | null; neutral?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{k}</span>
      {v ? <Badge variant="ok">{v}</Badge> : <Badge variant={neutral ? 'outline' : 'warn'}>{neutral ? 'No' : 'Pending'}</Badge>}
    </div>
  )
}

import { ArrowRight, CalendarClock, Check, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Disclaimer } from '@/components/Disclaimer'
import { StepIllustration } from '@/components/Illustrations'
import { Empty, ErrorBox, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ICCC } from '@/lib/constants'
import { useTrack } from '@/lib/track'
import { useAsync } from '@/lib/useAsync'
import { ageFrom, cn, fmtDateTime } from '@/lib/utils'

type StepState = 'done' | 'current' | 'upcoming'

export default function MeHome() {
  const { user } = useAuth()
  const { copy, junior } = useTrack()
  const { data, error, loading } = useAsync(async () => {
    const [candidate, instruments, progress, sessions] = await Promise.all([api.myCandidate(), api.myInstruments(), api.myProgress(), api.mySessions()])
    return { candidate, instruments, progress, sessions }
  }, [])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />
  const { candidate, instruments, progress, sessions } = data!
  if (!candidate) return <Empty title="Your profile is being set up">Your counsellor will link your account shortly.</Empty>

  const age = ageFrom(candidate.dob)
  const needsGuardian = (age === null || age < 18) && !candidate.guardian_consent_at
  const onboarded = Boolean(candidate.disclaimer_accepted_at) && !needsGuardian
  const completed = instruments.filter((i) => i.status === 'completed').length
  const assessed = instruments.length > 0 && completed === instruments.length
  const doneFlags = [onboarded, assessed, progress.attendedSessions > 0, progress.publishedOptions, progress.publishedRoadmap]
  const firstOpen = doneFlags.findIndex((d) => !d)
  const states: StepState[] = doneFlags.map((d, i) => (d ? 'done' : i === firstOpen ? 'current' : 'upcoming'))
  const links = ['/me/onboard', '/me/assess', '/me/sessions', junior ? '/me/streams' : '/me/options', '/me/roadmap']
  const pct = (doneFlags.filter(Boolean).length / doneFlags.length) * 100
  const nextSession = sessions.find((s) => new Date(s.scheduled_at) > new Date())
  const nextInstrument = instruments.find((i) => i.status === 'in_progress') ?? instruments.find((i) => i.status !== 'completed')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-pine-900 junior:text-4xl">{copy.hello(user?.full_name.split(' ')[0] ?? '')}</h1>
        <p className="mt-1 text-muted">{copy.intro}</p>
      </div>

      {needsGuardian && (
        <div className="flex items-start gap-3 rounded-xl border border-saffron-500/40 bg-saffron-400/15 p-4 text-pine-900">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-saffron-600" />
          <p>{junior ? 'Before you start the activities, a parent or guardian needs to say yes. Ask them to sign in and give consent.' : 'Because you are under 18, a linked parent or guardian must give consent before you can start the assessments.'}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-5 junior:p-7">
          <div className="mb-5 flex items-center gap-4">
            <Progress value={pct} label="Overall progress" />
            <span className="whitespace-nowrap text-sm font-bold text-pine-800">{Math.round(pct)}%</span>
          </div>
          <ol className="grid gap-3 md:grid-cols-5">
            {copy.steps.map((label, i) => (
              <li key={label}>
                <Link to={links[i]} className={cn('flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors junior:rounded-3xl', states[i] === 'current' ? 'border-pine-600 bg-pine-50 ring-2 ring-pine-200' : states[i] === 'done' ? 'border-line bg-white' : 'border-dashed border-line bg-sand-50 hover:bg-white')}
                  aria-current={states[i] === 'current' ? 'step' : undefined}>
                  <div className="flex items-center justify-between">
                    {junior ? <StepIllustration step={i} className="size-14" /> : (
                      <span className={cn('flex size-8 items-center justify-center rounded-full text-sm font-bold', states[i] === 'done' ? 'bg-ok text-white' : states[i] === 'current' ? 'bg-pine-700 text-white' : 'bg-sand-200 text-muted')}>
                        {states[i] === 'done' ? <Check className="size-4" /> : i + 1}
                      </span>
                    )}
                    {junior && states[i] === 'done' && <span className="flex size-7 items-center justify-center rounded-full bg-ok text-white"><Check className="size-4" /></span>}
                  </div>
                  <span className="font-bold text-pine-900">{label}</span>
                  <span className="text-sm text-muted">{copy.stepHints[i]}</span>
                  {i === 1 && <span className="text-xs font-semibold text-pine-700">{completed}/{instruments.length} {junior ? 'activities' : 'done'}</span>}
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{junior ? 'Up next' : 'Next step'}</CardTitle></CardHeader>
          <CardContent>
            {!onboarded ? (
              <Button asChild size="lg"><Link to="/me/onboard">{junior ? 'Finish your profile' : 'Complete onboarding'} <ArrowRight /></Link></Button>
            ) : nextInstrument ? (
              <div className="space-y-3">
                <p className="text-pine-900"><strong>{nextInstrument.name}</strong> · about {nextInstrument.est_minutes} min</p>
                <Button asChild size="lg"><Link to={`/me/assess/${nextInstrument.code}`}>{nextInstrument.status === 'in_progress' ? copy.resume : copy.start} <ArrowRight /></Link></Button>
              </div>
            ) : (
              <p className="text-muted">{junior ? 'All activities done! Your counsellor will talk you through them.' : 'All assessments are complete. Your counsellor will review results with you.'}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-pine-600" /> {junior ? 'Next chat' : 'Next session'}</CardTitle></CardHeader>
          <CardContent>
            {nextSession ? (
              <div>
                <div className="text-lg font-bold text-pine-900">{fmtDateTime(nextSession.scheduled_at)}</div>
                <div className="text-sm capitalize text-muted">{nextSession.mode.replace('_', ' ')} · {ICCC[nextSession.iccc_stage].label}</div>
                {nextSession.meeting_url && <Button asChild variant="secondary" size="sm" className="mt-3"><a href={nextSession.meeting_url} target="_blank" rel="noreferrer">Join link</a></Button>}
              </div>
            ) : <p className="text-muted">Your counsellor will schedule your next session.</p>}
          </CardContent>
        </Card>
      </div>

      <Disclaimer />
    </div>
  )
}

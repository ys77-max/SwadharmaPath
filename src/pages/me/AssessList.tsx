import { CheckCircle2, Clock, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ErrorBox, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/api'
import { useTrack } from '@/lib/track'
import { useAsync } from '@/lib/useAsync'

const EMOJI: Record<string, string> = { interest: '🎨', subject_enjoyment: '📚', aptitude: '🧩', workstyle: '🤝', school_values: '💛', values: '🧭', learning: '💡', bigfive: '🌱' }

export default function AssessList() {
  const { copy, junior } = useTrack()
  const { data, error, loading } = useAsync(() => api.myInstruments(), [])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <div>
      <PageHeader title={copy.assessTitle} subtitle={copy.assessIntro} />
      <div className="grid gap-4 md:grid-cols-2">
        {data!.map((i) => {
          const done = i.status === 'completed'
          const started = i.status === 'in_progress'
          return (
            <Card key={i.instrument_id} className="flex flex-col gap-4 p-5 junior:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {junior && <span className="text-4xl" aria-hidden>{EMOJI[i.code] ?? '⭐'}</span>}
                  <div>
                    <h2 className="text-lg font-bold text-pine-900">{i.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                      <span className="flex items-center gap-1"><Clock className="size-4" /> about {i.est_minutes} min</span>
                      <span>{i.item_count} {junior ? 'questions' : 'items'}</span>
                      {i.time_limit_min && <span className="flex items-center gap-1 font-semibold text-saffron-600"><Timer className="size-4" /> timed</span>}
                    </div>
                  </div>
                </div>
                {done ? <Badge variant="ok"><CheckCircle2 className="size-3" /> {copy.done}</Badge> : started ? <Badge variant="warn">In progress</Badge> : <Badge variant="outline">Not started</Badge>}
              </div>
              {started && <Progress value={(i.answered / Math.max(1, i.item_count)) * 100} label={`${i.name} progress`} />}
              {!done && (
                <Button asChild size={junior ? 'lg' : 'default'} className="self-start" variant={started ? 'default' : 'secondary'}>
                  <Link to={`/me/assess/${i.code}`}>{started ? copy.resume : copy.start}</Link>
                </Button>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

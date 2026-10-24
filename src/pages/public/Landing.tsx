import { ArrowRight, Compass, LineChart, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Disclaimer } from '@/components/Disclaimer'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { useAuth, HOME_FOR_ROLE } from '@/lib/auth'

export default function Landing() {
  const { user } = useAuth()
  return (
    <div className="min-h-dvh bg-sand-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 text-lg font-extrabold text-pine-900"><Logo /> SwadharmaPath</div>
        <Button asChild variant="outline"><Link to={user ? HOME_FOR_ROLE[user.role] : '/login'}>{user ? 'Open my space' : 'Sign in'}</Link></Button>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-pine-900 sm:text-5xl">
          From “what should I do?” to a plan you believe in.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Career guidance for Class 8–10 stream choice, Class 11–12 and college career choice, and working professionals planning a change. Assessments, one-to-one counselling and a dated roadmap, with your family in the loop.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" variant="accent"><Link to="/enquire">Book a discovery call <ArrowRight /></Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/about">How it works</Link></Button>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Compass, t: 'Know yourself', d: 'Interests, aptitude, work style and values, interpreted by a trained counsellor.' },
            { icon: Users, t: 'Talk it through', d: 'Structured sessions that bring the family into the decision.' },
            { icon: LineChart, t: 'Plan and act', d: 'Ranked options with pathways, exams and a roadmap you can track.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-xl border border-line bg-white p-5">
              <Icon className="size-6 text-pine-600" />
              <h2 className="mt-3 font-bold text-pine-900">{t}</h2>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
        <Disclaimer className="mt-12" />
      </section>
    </div>
  )
}

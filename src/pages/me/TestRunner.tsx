import { ArrowLeft, Check, CloudOff, Loader2, Save, Timer } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorBox, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/api'
import { AUTOSAVE_MS, fmtClock, forcedChoiceComplete, remainingSeconds, ResponseBuffer } from '@/lib/runner'
import { useTrack } from '@/lib/track'
import type { NextItem } from '@/lib/types'
import { cn } from '@/lib/utils'

type Phase = 'loading' | 'item' | 'submitting' | 'finished' | 'error'
type SaveState = { at: Date | null; failed: boolean; saving: boolean }

const FACES = ['😟', '🙁', '😐', '🙂', '😄']

// De-duplicates session creation when effects run twice (React StrictMode, fast remounts).
const starting = new Map<string, Promise<string>>()
function startOnce(candidateId: string, instrumentId: string) {
  const key = `${candidateId}:${instrumentId}`
  if (!starting.has(key)) {
    starting.set(key, api.startAssessment(candidateId, instrumentId).finally(() => setTimeout(() => starting.delete(key), 5000)))
  }
  return starting.get(key)!
}

/**
 * One item per screen. Items come one at a time from next_item(); answers are
 * buffered and flushed every 30 s (and on section change, tab hide, exit and
 * finish). Timed sections show a countdown on the server's clock and have no
 * back navigation.
 */
export default function TestRunner() {
  const { instrument = '' } = useParams()
  const navigate = useNavigate()
  const { copy, junior } = useTrack()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [cur, setCur] = useState<NextItem | null>(null)
  const [selection, setSelection] = useState<unknown>(undefined)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ at: null, failed: false, saving: false })

  const sessionId = useRef<string | null>(null)
  const buffer = useRef(new ResponseBuffer())
  const shownAt = useRef(0)
  const clockOffset = useRef(0)
  const advancing = useRef(false)

  const flush = useCallback(async () => {
    const sid = sessionId.current
    if (!sid || buffer.current.size === 0) return
    const batch = buffer.current.take()
    setSave((s) => ({ ...s, saving: true }))
    try {
      await api.saveResponses(sid, batch)
      setSave({ at: new Date(), failed: false, saving: false })
    } catch {
      buffer.current.restore(batch)
      setSave((s) => ({ ...s, failed: true, saving: false }))
    }
  }, [])

  const finish = useCallback(async () => {
    setPhase('submitting')
    await flush()
    try {
      await api.completeAssessment(sessionId.current!)
      setPhase('finished')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }, [flush])

  const load = useCallback(async (position?: number) => {
    const sid = sessionId.current!
    const res = await api.nextItem(sid, position)
    if (res.done) return finish()
    clockOffset.current = Date.now() - Date.parse(res.section!.server_now)
    shownAt.current = Date.now()
    setCur((prev) => {
      if (prev?.section && prev.section.code !== res.section!.code && prev.section.time_limit_sec) {
        const r = remainingSeconds(prev.section.time_limit_sec, prev.section.started_at!, clockOffset.current)
        if (r === 0) setNotice(junior ? 'Time’s up for that part! On to the next one.' : 'Time is up for that section. Moving on.')
      }
      return res
    })
    const prevAnswer = buffer.current.get(res.item!.id) ?? res.answer
    setSelection(prevAnswer?.a)
    setPhase('item')
  }, [finish, junior])

  const loadRef = useRef(load)
  loadRef.current = load

  // start or resume (runs once per instrument; never creates a second session)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, me] = await Promise.all([api.myInstruments(), api.myCandidate()])
        const inst = list.find((i) => i.code === instrument)
        if (!inst || !me) throw new Error('This assessment is not available for you.')
        setName(inst.name)
        if (inst.status === 'completed') return setPhase('finished')
        sessionId.current = inst.session_id ?? (await startOnce(me.id, inst.instrument_id))
        if (!cancelled) await loadRef.current()
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setPhase('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [instrument])

  // autosave every 30 s, and when the tab is hidden
  useEffect(() => {
    const t = setInterval(flush, AUTOSAVE_MS)
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const timed = Boolean(cur?.section?.time_limit_sec)

  // countdown for timed sections
  useEffect(() => {
    if (!cur?.section?.time_limit_sec || !cur.section.started_at || phase !== 'item') {
      setRemaining(null)
      return
    }
    const { time_limit_sec, started_at } = cur.section
    const tick = async () => {
      const r = remainingSeconds(time_limit_sec, started_at, clockOffset.current)
      setRemaining(r)
      if (r === 0 && !advancing.current) {
        advancing.current = true
        await flush()
        setTimeout(async () => {
          try { await load((cur.position ?? 0) + 1) } finally { advancing.current = false }
        }, 1000)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [cur, phase, flush, load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const answer = useCallback(async (a: unknown) => {
    if (!cur?.item || advancing.current) return
    advancing.current = true
    setSelection(a)
    buffer.current.put(cur.item.id, { a, rt: Date.now() - shownAt.current })
    try {
      if (timed) await flush() // timed answers are persisted straight away
      await new Promise((r) => setTimeout(r, 180)) // let the selection register visually
      await load((cur.position ?? 0) + 1)
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    } finally {
      advancing.current = false
    }
  }, [cur, timed, flush, load])

  // keyboard: number keys pick an option
  useEffect(() => {
    if (phase !== 'item' || !cur?.item || cur.item.type === 'forced_choice') return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (n >= 1 && n <= cur.item!.options.length) answer(cur.item!.options[n - 1].value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, cur, answer])

  if (phase === 'loading') return <Loading />
  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <ErrorBox error={error ?? 'Something went wrong'} />
        <Button asChild variant="outline"><Link to="/me/assess"><ArrowLeft /> Back to {copy.assessTitle.toLowerCase()}</Link></Button>
      </div>
    )
  }
  if (phase === 'finished' || phase === 'submitting') {
    return (
      <Card className="mx-auto max-w-xl p-8 text-center junior:p-10">
        {phase === 'submitting' ? <Loader2 className="mx-auto size-10 animate-spin text-pine-600" /> : (
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-ok/15 text-ok"><Check className="size-7" /></div>
        )}
        <h1 className="mt-4 text-2xl font-extrabold text-pine-900">{phase === 'submitting' ? 'Saving your answers…' : copy.finishTitle}</h1>
        {phase === 'finished' && <p className="mt-2 text-muted">{copy.finishBody}</p>}
        {phase === 'finished' && <Button asChild className="mt-6" size="lg"><Link to="/me/assess">Back to {copy.assessTitle.toLowerCase()}</Link></Button>}
      </Card>
    )
  }

  const item = cur!.item!
  const section = cur!.section!
  const pos = cur!.position ?? 0
  const canGoBack = !timed && pos > 0

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-muted">{name}{section.name && section.code !== 'main' && ` · ${section.name}`}</div>
          <div className="text-xs text-muted">Question {pos + 1} of {cur!.total}</div>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator s={save} />
          {remaining !== null && (
            <div className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-sm font-bold tabular-nums', remaining <= 30 ? 'bg-danger/10 text-danger' : 'bg-pine-100 text-pine-800')} role="timer" aria-live="off" aria-label="Time left in this section">
              <Timer className="size-4" /> {fmtClock(remaining)}
            </div>
          )}
        </div>
      </div>
      <Progress value={(pos / cur!.total) * 100} label="Progress" className="mb-6" />

      {notice && <div className="mb-4 rounded-lg bg-saffron-400/20 px-4 py-2 text-sm font-semibold text-pine-900" role="status">{notice}</div>}
      {timed && section.index === 0 && <p className="mb-4 rounded-lg bg-sand-100 px-4 py-2 text-sm text-pine-900">{copy.timedNote}</p>}

      <Card className="p-6 junior:p-8">
        <h1 className="text-xl font-bold leading-snug text-pine-900 junior:text-2xl">{item.prompt}</h1>
        <div className="mt-6">
          {item.type === 'likert5' && (
            <div className={cn('grid gap-2', junior ? 'grid-cols-5' : 'sm:grid-cols-5')} role="radiogroup" aria-label={item.prompt}>
              {item.options.map((o, i) => (
                <button key={String(o.value)} role="radio" aria-checked={selection === o.value} onClick={() => answer(o.value)}
                  className={cn('flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-sm font-semibold transition-colors', selection === o.value ? 'border-pine-600 bg-pine-50 text-pine-900' : 'border-line bg-white text-muted hover:border-pine-300')}>
                  {junior && <span className="text-3xl" aria-hidden>{FACES[i]}</span>}
                  <span className="text-center leading-tight">{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {item.type === 'mcq' && (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={item.prompt}>
              {item.options.map((o, i) => (
                <button key={String(o.value)} role="radio" aria-checked={selection === o.value} onClick={() => answer(o.value)}
                  className={cn('flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left font-semibold transition-colors', selection === o.value ? 'border-pine-600 bg-pine-50' : 'border-line bg-white hover:border-pine-300')}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand-200 text-sm text-pine-900">{String.fromCharCode(65 + i)}</span>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {item.type === 'pair' && (
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={item.prompt}>
              {item.options.map((o) => (
                <button key={String(o.value)} role="radio" aria-checked={selection === o.value} onClick={() => answer(o.value)}
                  className={cn('rounded-2xl border-2 px-5 py-8 text-lg font-bold transition-colors', selection === o.value ? 'border-pine-600 bg-pine-50 text-pine-900' : 'border-line bg-white text-pine-900 hover:border-pine-300')}>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {item.type === 'forced_choice' && (
            <ForcedChoice key={item.id} options={item.options} value={selection as { most?: string; least?: string } | undefined} junior={junior}
              onChange={setSelection} onNext={(v) => answer(v)} />
          )}
        </div>
        <p className="mt-5 text-sm text-muted">{copy.runnerEncourage}</p>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        {canGoBack ? <Button variant="ghost" onClick={() => load(pos - 1)}><ArrowLeft /> Back</Button> : <span />}
        <Button variant="outline" onClick={async () => { await flush(); navigate('/me/assess') }}><Save /> Save and exit</Button>
      </div>
    </div>
  )
}

function ForcedChoice({ options, value, onChange, onNext, junior }: {
  options: { value: string | number; label: string }[]
  value?: { most?: string; least?: string }
  onChange: (v: { most?: string; least?: string }) => void
  onNext: (v: { most: string; least: string }) => void
  junior: boolean
}) {
  const v = value ?? {}
  const pick = (k: 'most' | 'least', val: string) => {
    const other = k === 'most' ? 'least' : 'most'
    onChange({ ...v, [k]: val, ...(v[other] === val ? { [other]: undefined } : {}) })
  }
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2">
        <span />
        <span className="w-20 text-center text-xs font-bold uppercase tracking-wide text-ok">{junior ? 'Most me' : 'Most'}</span>
        <span className="w-20 text-center text-xs font-bold uppercase tracking-wide text-danger">{junior ? 'Least me' : 'Least'}</span>
        {options.map((o) => {
          const val = String(o.value)
          return [
            <span key={`${val}-l`} className="rounded-lg bg-sand-50 px-3 py-2.5 font-semibold text-pine-900">{o.label}</span>,
            <button key={`${val}-m`} onClick={() => pick('most', val)} aria-pressed={v.most === val} aria-label={`${o.label}: most like me`}
              className={cn('h-10 w-20 rounded-lg border-2 font-bold', v.most === val ? 'border-ok bg-ok text-white' : 'border-line bg-white text-muted hover:border-ok/50')}>+</button>,
            <button key={`${val}-x`} onClick={() => pick('least', val)} aria-pressed={v.least === val} aria-label={`${o.label}: least like me`}
              className={cn('h-10 w-20 rounded-lg border-2 font-bold', v.least === val ? 'border-danger bg-danger text-white' : 'border-line bg-white text-muted hover:border-danger/50')}>−</button>,
          ]
        })}
      </div>
      <Button className="mt-5" size="lg" disabled={!forcedChoiceComplete(v)} onClick={() => onNext(v as { most: string; least: string })}>Next</Button>
    </div>
  )
}

function SaveIndicator({ s }: { s: SaveState }) {
  if (s.failed) return <span className="flex items-center gap-1 text-xs font-semibold text-danger"><CloudOff className="size-3.5" /> Not saved, retrying</span>
  if (s.saving) return <span className="flex items-center gap-1 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Saving</span>
  if (s.at) return <span className="text-xs text-muted">Saved {s.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
  return <span className="text-xs text-muted">Autosaves every 30 s</span>
}

import { Mail, Phone } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { ErrorBox } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { PERSONAS } from '@/lib/api/demoPersonas'
import { HOME_FOR_ROLE, useAuth } from '@/lib/auth'
import { DEMO_MODE } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export default function Login() {
  const { user, refresh } = useAuth()
  const loc = useLocation()
  const [mode, setMode] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('+91')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? HOME_FOR_ROLE[user.role]} replace />

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault()
    run(() => api.signInWithPassword(email, password))
  }
  const onPhone = (e: FormEvent) => {
    e.preventDefault()
    if (!otpSent) run(async () => { await api.sendPhoneOtp(phone); setOtpSent(true) })
    else run(() => api.verifyPhoneOtp(phone, otp))
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-pine-700 to-pine-900 px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-xl font-extrabold text-sand-50">
          <Logo className="size-9" /> SwadharmaPath
        </Link>
        <Card>
          <CardContent className="p-6">
            <h1 className="text-xl font-extrabold text-pine-900">Sign in</h1>
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-sand-100 p-1" role="tablist">
              {(['email', 'phone'] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={cn('flex items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold', mode === m ? 'bg-white text-pine-900 shadow-sm' : 'text-muted')}>
                  {m === 'email' ? <Mail className="size-4" /> : <Phone className="size-4" />} {m === 'email' ? 'Email' : 'Phone OTP'}
                </button>
              ))}
            </div>
            {error && <ErrorBox error={error} className="mt-4" />}
            {mode === 'email' ? (
              <form onSubmit={onEmail} className="mt-4 space-y-4">
                <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Password"><Input type="password" autoComplete="current-password" required={!DEMO_MODE} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <Button className="w-full" size="lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
              </form>
            ) : (
              <form onSubmit={onPhone} className="mt-4 space-y-4">
                <Field label="Mobile number" hint="We’ll send a 6-digit code by SMS."><Input type="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={otpSent} /></Field>
                {otpSent && <Field label="Code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>}
                <Button className="w-full" size="lg" disabled={busy}>{otpSent ? 'Verify and sign in' : 'Send code'}</Button>
              </form>
            )}
            {DEMO_MODE && (
              <div className="mt-6 border-t border-line pt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Demo accounts</p>
                <div className="grid gap-2">
                  {PERSONAS.map((p) => (
                    <Button key={p.email} variant="outline" className="justify-start" disabled={busy} onClick={() => run(() => api.signInWithPassword(p.email, ''))}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-sm text-sand-200">New here? <Link className="font-semibold text-saffron-400 underline" to="/enquire">Make an enquiry</Link></p>
      </div>
    </div>
  )
}

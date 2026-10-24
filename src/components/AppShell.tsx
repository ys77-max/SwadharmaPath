import { LogOut, Menu, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { DEMO_MODE } from '@/lib/supabase'
import { useTrack } from '@/lib/track'
import type { Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'

type NavItem = { to: string; label: string; end?: boolean }

export function navFor(role: Role, junior: boolean): NavItem[] {
  switch (role) {
    case 'candidate':
      return [
        { to: '/me', label: 'Me', end: true },
        { to: '/me/assess', label: junior ? 'Discover' : 'Assess' },
        { to: junior ? '/me/streams' : '/me/options', label: junior ? 'Streams' : 'Options' },
        { to: '/me/roadmap', label: junior ? 'Explore Plan' : 'Roadmap' },
        { to: '/me/sessions', label: junior ? 'Talk' : 'Sessions' },
      ]
    case 'parent':
      return [{ to: '/family', label: 'Family', end: true }]
    case 'counsellor':
      return [
        { to: '/cases', label: 'Cases' },
        { to: '/schedule', label: 'Schedule' },
        { to: '/reports/queue', label: 'Reports' },
        { to: '/library', label: 'Library' },
        { to: '/settings', label: 'Settings' },
      ]
    case 'admin':
      return [
        { to: '/admin', label: 'Dashboard', end: true },
        { to: '/admin/leads', label: 'Leads' },
        { to: '/admin/counsellors', label: 'Counsellors' },
        { to: '/admin/careers', label: 'Library' },
        { to: '/admin/instruments', label: 'Instruments' },
        { to: '/admin/templates', label: 'Templates' },
        { to: '/admin/archive', label: 'Archive' },
        { to: '/cases', label: 'Cases' },
      ]
  }
}

/** Track switch: candidates get their own track; staff and demo users can preview either. */
export function TrackSwitch() {
  const { track, setTrack } = useTrack()
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-full bg-pine-800 px-3 py-1.5 text-xs font-semibold text-sand-100">
      <Sparkles className="size-3.5 text-saffron-400" />
      Early explorer view
      <Switch
        checked={track === 'early_explorer'}
        onCheckedChange={(on) => setTrack(on ? 'early_explorer' : 'student')}
        aria-label="Preview the early explorer (Class 8–10) experience"
      />
    </label>
  )
}

export function AppShell() {
  const { user, signOut } = useAuth()
  const { junior, setTrack } = useTrack()
  const [open, setOpen] = useState(false)
  const loc = useLocation()

  useEffect(() => setOpen(false), [loc.pathname])

  // A candidate's track comes from their record, not from the switch.
  useEffect(() => {
    if (user?.role !== 'candidate') return
    api.myCandidate().then((c) => c && setTrack(c.track)).catch(() => {})
  }, [user, setTrack])

  if (!user) return null
  const items = navFor(user.role, junior)
  const canPreview = DEMO_MODE || user.role === 'counsellor' || user.role === 'admin'

  return (
    <div className="min-h-dvh">
      {DEMO_MODE && (
        <div className="bg-saffron-500 px-4 py-1 text-center text-xs font-semibold text-pine-900">
          Demo mode: fictional data, nothing is saved. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect.
        </div>
      )}
      <header className="sticky top-0 z-30 bg-pine-700 text-sand-50 shadow">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">SwadharmaPath</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  cn('rounded-lg px-3 py-2 text-[0.95rem] font-semibold text-sand-100/85 hover:bg-pine-600 hover:text-white', isActive && 'bg-pine-800 text-white')
                }
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {canPreview && (
              <div className="hidden lg:block">
                <TrackSwitch />
              </div>
            )}
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-semibold">{user.full_name}</div>
              <div className="text-xs capitalize text-sand-200/80">{user.role}</div>
            </div>
            <button onClick={signOut} className="hidden rounded-lg p-2 hover:bg-pine-600 sm:block" aria-label="Sign out" title="Sign out">
              <LogOut className="size-5" />
            </button>
            <button className="rounded-lg p-2 hover:bg-pine-600 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-pine-600 px-4 pb-4 md:hidden" aria-label="Main mobile">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('block rounded-lg px-3 py-2.5 font-semibold', isActive ? 'bg-pine-800' : 'hover:bg-pine-600')}>
                {i.label}
              </NavLink>
            ))}
            {canPreview && (
              <div className="mt-3">
                <TrackSwitch />
              </div>
            )}
            <button onClick={signOut} className="mt-2 flex items-center gap-2 px-3 py-2 font-semibold">
              <LogOut className="size-4" /> Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import type { AppUser, Role } from './types'

interface AuthState {
  user: AppUser | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export const HOME_FOR_ROLE: Record<Role, string> = {
  candidate: '/me',
  parent: '/family',
  counsellor: '/cases',
  admin: '/admin',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.currentUser())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return api.onAuthChange(() => {
      refresh()
    })
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.signOut()
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { HOME_FOR_ROLE, useAuth } from '@/lib/auth'
import type { Role } from '@/lib/types'
import { Loading } from './states'

/** Route guard. Unauthenticated → /login; wrong role → that role's home. RLS still enforces access server-side. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading className="justify-center" />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!roles.includes(user.role)) return <Navigate to={HOME_FOR_ROLE[user.role]} replace />
  return <>{children}</>
}

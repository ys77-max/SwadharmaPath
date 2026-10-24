import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 py-10 text-muted', className)} role="status">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  )
}

export function ErrorBox({ error, className }: { error: Error | string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger', className)} role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{typeof error === 'string' ? error : error.message}</span>
    </div>
  )
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-sand-50 px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sand-200 text-pine-700">{icon}</div>}
      <p className="font-bold text-pine-900">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-pine-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

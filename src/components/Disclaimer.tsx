import { Info } from 'lucide-react'
import { DISCLAIMER } from '@/lib/constants'
import { cn } from '@/lib/utils'

export function Disclaimer({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <aside className={cn('flex gap-3 rounded-xl border border-sand-300 bg-sand-100 p-4 text-sm text-pine-900', className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-pine-600" />
      <p className={cn(compact && 'line-clamp-3')}>{DISCLAIMER}</p>
    </aside>
  )
}

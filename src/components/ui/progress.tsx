import { cn } from '@/lib/utils'

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2.5 w-full overflow-hidden rounded-full bg-sand-200 junior:h-4', className)}
    >
      <div className="h-full rounded-full bg-pine-600 transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  )
}

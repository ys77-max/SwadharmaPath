import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-pine-100 text-pine-800',
      sand: 'bg-sand-200 text-pine-900',
      warn: 'bg-saffron-400/30 text-saffron-600',
      danger: 'bg-danger/10 text-danger',
      ok: 'bg-ok/10 text-ok',
      outline: 'border border-line text-muted',
      lock: 'bg-pine-900 text-sand-100',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

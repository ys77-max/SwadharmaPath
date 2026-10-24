import * as React from 'react'
import { cn } from '@/lib/utils'

const field = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[0.95rem] text-ink placeholder:text-muted/70 focus:border-pine-400 focus:outline-none focus:ring-2 focus:ring-pine-200 disabled:opacity-60'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(field, 'h-10', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-24', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(field, 'h-10 pr-8', className)} {...props} />
))
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-sm font-semibold text-pine-900', className)} {...props} />
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  // Wrapping <label> associates the text with the control inside it.
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm font-semibold text-pine-900">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

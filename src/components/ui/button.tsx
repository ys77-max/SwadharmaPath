import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 junior:rounded-2xl [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-pine-700 text-sand-50 hover:bg-pine-800',
        secondary: 'bg-sand-200 text-pine-900 hover:bg-sand-300',
        outline: 'border border-line bg-white text-pine-800 hover:bg-sand-100',
        ghost: 'text-pine-800 hover:bg-sand-100',
        danger: 'bg-danger text-white hover:bg-danger/90',
        accent: 'bg-saffron-500 text-pine-900 hover:bg-saffron-400',
      },
      size: {
        default: 'h-10 px-4 text-[0.95rem]',
        sm: 'h-8 px-3 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
})
Button.displayName = 'Button'

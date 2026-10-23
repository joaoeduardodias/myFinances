import type * as React from 'react'

import { cn } from '@/lib/utils'

/** `<select>` nativo com o visual dos inputs: acessível e simples no mobile. */
export function NativeSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input dark:bg-input/30 bg-background text-foreground h-9 w-full min-w-0 rounded-md border px-2 text-sm shadow-xs outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&_option]:bg-popover [&_option]:text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

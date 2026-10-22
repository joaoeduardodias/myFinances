import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react'
import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4',
        month: 'flex w-full flex-col gap-4',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 p-0 aria-disabled:opacity-50',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 p-0 aria-disabled:opacity-50',
        ),
        month_caption: 'flex h-8 items-center justify-center px-8',
        dropdowns: 'flex items-center gap-1.5 text-sm font-medium',
        dropdown_root:
          'border-input has-focus:border-ring has-focus:ring-ring/50 relative rounded-md border has-focus:ring-[3px]',
        dropdown: 'absolute inset-0 opacity-0',
        caption_label:
          'flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-sm font-medium capitalize [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'text-muted-foreground w-8 text-[0.8rem] font-normal capitalize',
        week: 'mt-1 flex w-full',
        day: 'size-8 p-0 text-center text-sm',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 p-0 font-normal',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today: '[&>button]:bg-accent [&>button]:text-accent-foreground',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) => {
          const Icon =
            orientation === 'left'
              ? ChevronLeftIcon
              : orientation === 'right'
                ? ChevronRightIcon
                : ChevronDownIcon
          return <Icon className={cn('size-4', chevronClassName)} />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }

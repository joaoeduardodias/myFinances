import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  /** Classe do nome ao lado do ícone; permite escondê-lo na sidebar recolhida. */
  nameClassName?: string
}

export function Logo({ className, nameClassName }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', className)}>
      <img
        src="/favicon.svg"
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0"
      />
      <span className={nameClassName}>myFinances</span>
    </span>
  )
}

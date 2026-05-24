import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function Message({
  role,
  className,
  children,
}: {
  role: 'user' | 'assistant' | 'system'
  className?: string
  children: ReactNode
}) {
  return (
    <article
      data-role={role}
      className={cn(
        'grid grid-cols-[4.75rem_minmax(0,1fr)] gap-4 border-b py-4 last:border-b-0',
        role === 'user' ? 'items-start' : 'items-start',
        className,
      )}
    >
      <div className="flex justify-end">
        <Badge variant={role === 'user' ? 'default' : 'outline'}>{role === 'user' ? 'User' : role}</Badge>
      </div>
      <div className="min-w-0">{children}</div>
    </article>
  )
}

export function MessageContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('min-w-0 text-[0.95rem] leading-7 text-foreground', className)}>{children}</div>
}

export function MessageResponse({ children }: { children: string }) {
  return <div className="whitespace-pre-wrap break-words">{children}</div>
}

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ className, ...props }) => (
          <a className={cn('font-medium underline underline-offset-4', className)} target="_blank" rel="noreferrer" {...props} />
        ),
        code: ({ className, ...props }) => (
          <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]', className)} {...props} />
        ),
        pre: ({ className, ...props }) => (
          <pre className={cn('my-3 overflow-auto rounded-md border bg-muted p-3 text-sm', className)} {...props} />
        ),
        ol: ({ className, ...props }) => <ol className={cn('my-3 list-decimal pl-5', className)} {...props} />,
        ul: ({ className, ...props }) => <ul className={cn('my-3 list-disc pl-5', className)} {...props} />,
        p: ({ className, ...props }) => <p className={cn('my-2 first:mt-0 last:mb-0', className)} {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

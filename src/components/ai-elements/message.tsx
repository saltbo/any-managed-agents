import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function Message({
  role,
  timestamp,
  status,
  statusDetail,
  className,
  children,
}: {
  role: 'user' | 'assistant' | 'system'
  timestamp?: string
  status?: 'streaming' | 'complete' | 'error'
  statusDetail?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <article
      data-role={role}
      className={cn(
        'grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0',
        role === 'user' ? 'items-start' : 'items-start',
        className,
      )}
    >
      <div className="flex flex-col items-end gap-1">
        <Badge variant={role === 'user' ? 'default' : 'outline'}>{role === 'user' ? 'User' : role}</Badge>
        {timestamp ? <span className="text-[11px] text-muted-foreground">{timestamp}</span> : null}
        {status === 'streaming' ? (
          <Badge variant="secondary" className="text-[10px]">
            Streaming
          </Badge>
        ) : null}
        {status === 'error' ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={statusDetail ? `Error: ${statusDetail}` : 'Error'}
                  className="inline-flex cursor-help border-0 bg-transparent p-0"
                >
                  <Badge variant="destructive" className="text-[10px]">
                    Error
                  </Badge>
                </button>
              </TooltipTrigger>
              {statusDetail ? <TooltipContent>{statusDetail}</TooltipContent> : null}
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </article>
  )
}

export function MessageContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('min-w-0 text-sm leading-6 text-foreground', className)}>{children}</div>
}

export function MessageResponse({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ className, ...props }) => (
          <a
            className={cn('font-medium underline underline-offset-4', className)}
            target="_blank"
            rel="noreferrer"
            {...props}
          />
        ),
        code: ({ className, ...props }) => (
          <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]', className)} {...props} />
        ),
        pre: ({ className, ...props }) => (
          <pre className={cn('my-2 overflow-auto rounded-md border bg-muted p-3 text-sm', className)} {...props} />
        ),
        ol: ({ className, ...props }) => <ol className={cn('my-2 list-decimal pl-5', className)} {...props} />,
        ul: ({ className, ...props }) => <ul className={cn('my-2 list-disc pl-5', className)} {...props} />,
        p: ({ className, ...props }) => <p className={cn('my-1 first:mt-0 last:mb-0', className)} {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

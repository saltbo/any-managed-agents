import { ArrowDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export function Conversation({ className, children }: { className?: string; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [stuck, setStuck] = useState(true)

  useEffect(() => {
    if (!stuck) {
      return
    }
    if (viewportRef.current && 'scrollTo' in viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight })
    }
  })

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <ScrollArea className="h-full">
        <div
          ref={viewportRef}
          className="h-full overflow-y-auto px-1 py-5"
          onScroll={(event) => {
            const element = event.currentTarget
            setStuck(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
          }}
        >
          {children}
        </div>
      </ScrollArea>
      {!stuck ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="absolute right-4 bottom-4 rounded-full bg-background shadow-sm"
          aria-label="Scroll to latest message"
          onClick={() => {
            if (viewportRef.current && 'scrollTo' in viewportRef.current) {
              viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })
            }
            setStuck(true)
          }}
        >
          <ArrowDown />
        </Button>
      ) : null}
    </div>
  )
}

export function ConversationContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto flex w-full max-w-5xl flex-col gap-5', className)}>{children}</div>
}

import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export function JsonBlock({
  value,
  inverted = false,
  compact = false,
}: {
  value: string
  inverted?: boolean
  compact?: boolean
}) {
  return (
    <ScrollArea
      className={cn(
        compact ? 'max-h-48 rounded-md border p-2' : 'max-h-96 rounded-lg border p-3',
        inverted ? 'bg-primary text-primary-foreground' : 'bg-muted/30',
      )}
    >
      <pre className="whitespace-pre-wrap break-words text-xs">{value}</pre>
    </ScrollArea>
  )
}

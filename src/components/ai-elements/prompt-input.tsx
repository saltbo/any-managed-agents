import { CornerDownLeft, Square } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function PromptInput({
  value,
  disabled,
  busy,
  placeholder = 'Send a message to the agent',
  onChange,
  onSubmit,
  onAbort,
}: {
  value: string
  disabled?: boolean
  busy?: boolean
  placeholder?: string
  onChange: (value: string) => void
  onSubmit: () => void
  onAbort: () => void
}) {
  const formRef = useRef<HTMLFormElement | null>(null)
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!value.trim() || disabled) {
      return
    }
    onSubmit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  return (
    <form ref={formRef} className="sticky bottom-0 z-20 bg-background px-1 py-4" onSubmit={submit}>
      <div
        className={cn(
          'flex items-end gap-2 rounded-lg border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring',
          disabled && 'opacity-70',
        )}
      >
        <Textarea
          className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Abort running agent"
          disabled={!busy}
          onClick={onAbort}
        >
          <Square />
        </Button>
        <Button type="submit" disabled={disabled || !value.trim()}>
          Send
          <CornerDownLeft data-icon="inline-end" />
        </Button>
      </div>
    </form>
  )
}

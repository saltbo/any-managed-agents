import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyAgent } from '@/console/defaults'
import { parseJsonObject, parseTools, providerIdPatch } from '@/console/format'
import { AgentForm } from '@/console/forms'
import type { AgentFormState } from '@/console/types'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function CreateAgentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AgentFormState>(emptyAgent)
  const createAgent = useMutation({
    mutationFn: () =>
      api.createAgent({
        name: form.name,
        description: form.description,
        instructions: form.instructions,
        ...providerIdPatch(form.provider),
        model: form.model || null,
        skills: parseTools(form.skills),
        tools: parseTools(form.allowedTools).map((name) => ({ name })),
        mcpConnectors: parseTools(form.mcpConnectors),
        metadata: parseJsonObject(form.metadata, 'Metadata'),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyAgent)
      toast.success('Agent created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createAgent.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Agent</SheetTitle>
          <SheetDescription>
            Define a reusable agent profile. Runtime environments are selected when creating sessions.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <AgentForm
            value={form}
            setValue={setForm}
            submitLabel={createAgent.isPending ? 'Creating agent' : 'Save agent'}
            onSubmit={submit}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

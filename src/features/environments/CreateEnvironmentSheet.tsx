import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyEnvironment } from '@/console/defaults'
import { parsePackages, parseVariables } from '@/console/format'
import { EnvironmentForm } from '@/console/forms'
import type { EnvironmentFormState } from '@/console/types'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function CreateEnvironmentSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<EnvironmentFormState>(emptyEnvironment)
  const createEnvironment = useMutation({
    mutationFn: () =>
      api.createEnvironment({
        name: form.name,
        description: form.description,
        packages: parsePackages(form.packages),
        variables: parseVariables(form.variables),
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
        runtimeImage: { image: form.runtimeImage },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyEnvironment)
      toast.success('Environment created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createEnvironment.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Environment</SheetTitle>
          <SheetDescription>Define a reusable runtime environment for future sessions.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <EnvironmentForm value={form} setValue={setForm} onSubmit={submit} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
